import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from sqlalchemy import create_engine, text
from datetime import datetime, timedelta
import unicodedata
import time
import urllib3
import unidecode

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

MYSQL_STR = "mysql+pymysql://root:root@localhost/licitanet_db"
engine = create_engine(MYSQL_STR)

INTERVALO_DIAS = 6
ESTADOS = ['AC','AL','AP','AM','BA','ES','CE','GO','MA','MT','MS','MG','PA','PB','PE','PR','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']
MODALIDADES = [6, 7, 8, 9, 4, 5]

MAPA_MODALIDADES = {
    1: "Leilão", 2: "Diálogo Competitivo", 3: "Concurso",
    4: "Concorrência", 5: "Concorrência (Presencial)",
    6: "Pregão", 7: "Pregão (Presencial)",
    8: "Dispensa de Licitação", 9: "Inexigibilidade", 10: "Manifestação de Interesse"
}

# ✅ FIX 1: Headers completos que simulam um browser real
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "Origin": "https://pncp.gov.br",
    "Referer": "https://pncp.gov.br/app/editais",
    "Connection": "keep-alive",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
}

def criar_session():
    """✅ FIX 2: Session com retry automático e keep-alive"""
    session = requests.Session()
    session.headers.update(HEADERS)
    
    retry = Retry(
        total=3,
        backoff_factor=2,
        status_forcelist=[429, 500, 502, 503, 504],
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    
    # Faz uma requisição inicial ao portal para pegar cookies de sessão
    try:
        session.get("https://pncp.gov.br/app/editais", timeout=15, verify=False)
        time.sleep(1)
    except:
        pass
    
    return session

def normalizar_texto(texto):
    if not isinstance(texto, str): return ""
    return ''.join(c for c in unicodedata.normalize('NFD', texto) if unicodedata.category(c) != 'Mn').upper().strip()

def detectar_plataforma(item):
    unidade = item.get('unidadeOrgao', {})
    # ✅ FIX 3: Campo correto é 'orgaoEntidade', não 'orgao'
    orgao = item.get('orgaoEntidade', item.get('orgao', {}))
    
    pistas = [
        str(item.get('fonteSistema') or ''),
        str(item.get('linkSistemaOrigem') or item.get('linkSistemaOrigen') or ''),
        str(item.get('usuarioNome') or ''),
        str(unidade.get('nomeUnidade') or ''),
        str(orgao.get('razaoSocial') or '')
    ]
    
    investigacao = " ".join(pistas).lower()
    investigacao = unidecode.unidecode(investigacao)

    portais = {
        "Licitanet": ["licitanet", "licitanet.com"],
        "Compras.Gov.Br": ["comprasnet", "compras.gov", "compras-api", "governo federal", "economia.gov"],
        "Bll Compras": ["bll", "bll.org", "bllcompras", "bolsa de licitacoes"],
        "Portal de Compras Públicas": ["portal de compras publicas", "portal de compras", " pcp ", "publicas.com", "ecustomize"],
        "Bnc - Bolsa Nacional": ["bnc.org", "bolsa nacional", "bnccompras", "bnc", "Bolsa Nacional De Compras - BNC"],
        "Licitar Digital": ["licitar digital", "licitardigital", "licitardigital.com"],
        "Licitações-e (BB)": ["licitacoes-e", "bb.com.br", "banco do brasil"],
        "Compras Br": ["comprasbr", "compras-br", "comprasbr.com"],
        "BBMNET": ["bbmnet", "bbm"],
        "Start Gov": ["startgov"],
        "Br Conectado": ["br conectado"],
        "Licita Mais": ["licitamais", "licita+"],
        "Asm": ["asm.com", "asm sistemas"]
    }

    for nome_oficial, termos in portais.items():
        if any(termo in investigacao for termo in termos):
            return nome_oficial

    fonte_orig = str(item.get('fonteSistema') or '').strip()
    termos_invalidos = ["PNCP", "INTEGRACAO", "API", "SISTEMA", "NULL", "NONE"]
    
    if fonte_orig and len(fonte_orig) > 3 and not any(t in fonte_orig.upper() for t in termos_invalidos):
        return fonte_orig.title()

    return "Outros"

def eh_entidade_de_interesse(nome_orgao):
    nome = normalizar_texto(nome_orgao)
    termos = ["PREFEITURA", "MUNICIPIO", "PREF ", "FUNDO", "SECRETARIA", "CAMARA"]
    return any(termo in nome for termo in termos)

def salvar_no_mysql(lista_dados):
    query_insert = text("""
        INSERT IGNORE INTO licitacoes_raw 
        (id_pncp, cidade_norm, uf, sistema_fonte, nome_orgao, data_publicacao, cod_ibge, modalidade)
        VALUES 
        (:id_pncp, :cidade_norm, :uf, :sistema_fonte, :nome_orgao, :data_publicacao, :cod_ibge, :modalidade)
    """)
    with engine.begin() as conn:
        for item in lista_dados:
            conn.execute(query_insert, item)

def coletar_por_lotes(data_inicio_str, data_fim_str):
    url = "https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao"
    dt_geral_inicio = datetime.strptime(data_inicio_str, "%Y%m%d")
    dt_geral_fim = datetime.strptime(data_fim_str, "%Y%m%d")

    print(f"🚀 Iniciando Coleta com Modalidades...")

    # ✅ Cria uma session reutilizável para todas as requisições
    session = criar_session()
    requests_count = 0

    for uf in ESTADOS:
        print(f"\n🌍 Estado: {uf}")
        cursor_data = dt_geral_inicio

        while cursor_data <= dt_geral_fim:
            fim_janela = min(cursor_data + timedelta(days=INTERVALO_DIAS - 1), dt_geral_fim)
            s_ini = cursor_data.strftime("%Y%m%d")
            s_fim = fim_janela.strftime("%Y%m%d")
            print(f"📅 {cursor_data.strftime('%d/%m')} a {fim_janela.strftime('%d/%m')}: ", end="", flush=True)

            total_janela = 0

            for modalidade_id in MODALIDADES:
                nome_modalidade = MAPA_MODALIDADES.get(modalidade_id, "Desconhecida")

                for pagina in range(1, 50):
                    params = {
                        "dataInicial": s_ini,
                        "dataFinal": s_fim,
                        "uf": uf,
                        "pagina": pagina,
                        "tamanhoPagina": 50,
                        "codigoModalidadeContratacao": modalidade_id
                    }
                    try:
                        r = session.get(url, params=params, timeout=20, verify=False)
                        requests_count += 1

                        # ✅ Renovar session a cada 200 requisições (evita bloqueio por tempo)
                        if requests_count % 200 == 0:
                            print("\n🔄 Renovando sessão...", end="", flush=True)
                            session = criar_session()

                        if r.status_code == 403:
                            print(f"\n⚠️ 403 em {uf}/modalidade {modalidade_id}/pág {pagina} — renovando sessão...")
                            session = criar_session()
                            time.sleep(5)
                            continue  # tenta de novo

                        if r.status_code != 200:
                            break

                        dados = r.json().get('data', [])
                        if not dados:
                            break

                        lista_salvar = []
                        for item in dados:
                            try:
                                unidade = item.get('unidadeOrgao', {})
                                # ✅ FIX 3 aplicado aqui também
                                orgao_api = item.get('orgaoEntidade', item.get('orgao', {}))
                                orgao_nome = unidade.get('nomeUnidade') or orgao_api.get('razaoSocial', '')

                                if not eh_entidade_de_interesse(orgao_nome):
                                    continue

                                cidade = unidade.get('municipioNome') or orgao_api.get('municipio', {}).get('nome', '')
                                ibge = (unidade.get('codigoIbge') or unidade.get('codigoIBGE') or
                                        orgao_api.get('codigoIbge') or orgao_api.get('codigoIBGE'))

                                if not ibge or not cidade:
                                    continue

                                plataforma = detectar_plataforma(item)
                                mod_api = item.get('modalidadeNome', nome_modalidade)

                                lista_salvar.append({
                                    "id_pncp": str(item.get('numeroControlePNCP')),
                                    "cidade_norm": normalizar_texto(cidade).title(),
                                    "uf": uf,
                                    "sistema_fonte": plataforma,
                                    "nome_orgao": orgao_nome[:200],
                                    "data_publicacao": item.get('dataPublicacaoPncp', '')[:10],
                                    "cod_ibge": str(ibge),
                                    "modalidade": mod_api
                                })
                            except:
                                continue

                        if lista_salvar:
                            salvar_no_mysql(lista_salvar)
                            total_janela += len(lista_salvar)
                            print(".", end="", flush=True)

                        if len(dados) < 50:
                            break

                        time.sleep(0.3)  # ✅ pequeno delay entre páginas

                    except Exception as e:
                        print(f"\n❌ Erro: {e}")
                        continue

            print(f" ({total_janela} licitações salvas)")
            cursor_data = fim_janela + timedelta(days=1)
            time.sleep(0.5)

if __name__ == "__main__":
    coletar_por_lotes("20260508", "20260511")