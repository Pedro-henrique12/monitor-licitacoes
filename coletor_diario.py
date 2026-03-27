import requests
import pandas as pd
from sqlalchemy import create_engine, text
from datetime import datetime, timedelta
import unicodedata
import time
import urllib3
import unidecode
import os

# --- CONFIGURAÇÃO ---
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
MYSQL_STR = "mysql+mysqlconnector://root:root@localhost:3306/licitanet_db?charset=utf8mb4"
engine = create_engine(MYSQL_STR)

ESTADOS = ['AC','AL','AP','AM','BA','ES','CE','GO','MA','MT','MS','MG','PA','PB','PE','PR','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'] 
MODALIDADES = [6, 7, 8, 4, 13] # O combo completo
HEADERS = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}

def normalizar_texto(texto):
    if not isinstance(texto, str): return ""
    return ''.join(c for c in unicodedata.normalize('NFD', texto) if unicodedata.category(c) != 'Mn').upper().strip()

def detectar_plataforma(item):
    unidade = item.get('unidadeOrgao', {})
    orgao = item.get('orgao', {})
    pistas = [
        str(item.get('fonteSistema') or ''), str(item.get('linkSistemaOrigen') or ''),
        str(item.get('usuarioNome') or ''), str(unidade.get('nomeUnidade') or ''),
        str(orgao.get('razaoSocial') or '')
    ]
    investigacao = unidecode.unidecode(" ".join(pistas).lower())
    portais = {
        "Licitanet": ["licitanet", "licitanet.com"], "Compras.Gov.Br": ["comprasnet", "compras.gov", "compras-api", "governo federal"],
        "Bll Compras": ["bll", "bll.org", "bllcompras"], "Portal de Compras Públicas": ["portal de compras publicas", " pcp "],
        "Bnc - Bolsa Nacional": ["bnc.org", "bolsa nacional", "bnccompras", "bnc"], "Licitar Digital": ["licitar digital", "licitardigital"],
        "Licitações-e (BB)": ["licitacoes-e", "bb.com.br", "banco do brasil"], "Compras Br": ["comprasbr", "compras-br"],
        "BBMNET": ["bbmnet", "bbm"], "Start Gov": ["startgov"], "Br Conectado":["br conectado"], "Licita Mais": ["licitamais", "licita+"],
    }
    for nome_oficial, termos in portais.items():
        if any(termo in investigacao for termo in termos): return nome_oficial
    fonte_orig = str(item.get('fonteSistema') or '').strip()
    if fonte_orig and len(fonte_orig) > 3 and not any(t in fonte_orig.upper() for t in ["PNCP", "API", "NULL", "NONE"]):
        return fonte_orig.title()
    return "Outros"

def eh_entidade_de_interesse(nome_orgao):
    termos = ["PREFEITURA", "MUNICIPIO", "PREF ", "FUNDO", "SECRETARIA", "CAMARA"]
    return any(termo in normalizar_texto(nome_orgao) for termo in termos)

def salvar_no_mysql(lista_dados):
    if not lista_dados: return
    sql = """
    INSERT IGNORE INTO licitacoes_raw 
    (id_pncp, cod_ibge, cidade_norm, uf, sistema_fonte, nome_orgao, data_publicacao, created_at)
    VALUES (:id_pncp, :cod_ibge, :cidade_norm, :uf, :sistema_fonte, :nome_orgao, :data_publicacao, :created_at)
    """
    try:
        with engine.begin() as conn:
            conn.execute(text(sql), lista_dados)
    except Exception as e: print(f"Erro ao salvar no banco: {e}")

def coletar_dia(data_alvo_str):
    url = "https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao"
    print(f"🤖 INICIANDO COLETA DIÁRIA ({data_alvo_str})...")

    for uf in ESTADOS:
        total_uf = 0
        for modalidade in MODALIDADES:
            for pagina in range(1, 10): 
                params = {"dataInicial": data_alvo_str, "dataFinal": data_alvo_str, "uf": uf, "pagina": pagina, "tamanhoPagina": 50, "codigoModalidadeContratacao": modalidade}
                try:
                    r = requests.get(url, params=params, headers=HEADERS, timeout=20, verify=False)
                    if r.status_code == 200:
                        dados = r.json().get('data', [])
                        if not dados: break
                        
                        lista_salvar = []
                        for item in dados:
                            try:
                                unidade = item.get('unidadeOrgao', {})
                                orgao_api = item.get('orgao', {})
                                orgao_nome = unidade.get('nomeUnidade') or orgao_api.get('razaoSocial', '')
                                
                                if not eh_entidade_de_interesse(orgao_nome): continue
                                cidade = unidade.get('municipioNome') or orgao_api.get('municipio', {}).get('nome', '')
                                ibge = unidade.get('codigoIbge') or orgao_api.get('codigoIbge')
                                if not ibge or not cidade: continue

                                lista_salvar.append({
                                    "id_pncp": str(item.get('numeroControlePNCP')), "cidade_norm": normalizar_texto(cidade).title(),
                                    "uf": uf, "sistema_fonte": detectar_plataforma(item), "nome_orgao": orgao_nome[:200],
                                    "data_publicacao": item.get('dataPublicacaoPncp')[:19], "cod_ibge": str(ibge),
                                    "created_at": datetime.now()
                                })
                            except: continue
                        
                        if lista_salvar:
                            salvar_no_mysql(lista_salvar)
                            total_uf += len(lista_salvar)
                        if len(dados) < 50: break
                    else: break
                except: continue
            time.sleep(0.5)
        print(f"✅ UF: {uf} - {total_uf} licitações salvas.")

if __name__ == "__main__":
    # Como roda 00h00, pega os dados do dia que acabou de terminar (ontem)
    ontem = (datetime.now() - timedelta(days=1)).strftime("%Y%m%d")
    
    coletar_dia(ontem)
    
    print("\n🔄 Atualizando Inteligência (Views)...")
    # Atualiza o mapa e os gráficos com os novos dados
    os.system("python 2_criar_views.py")
    print("🏁 PROCESSO DIÁRIO FINALIZADO COM SUCESSO!")