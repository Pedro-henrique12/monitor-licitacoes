import requests
from sqlalchemy import create_engine, text
from datetime import datetime, timedelta
import unicodedata
import time
import sys
import urllib3
import unidecode

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
MYSQL_STR = "mysql+mysqlconnector://root:root@localhost:3306/licitanet_db?charset=utf8mb4"
engine = create_engine(MYSQL_STR)

# --- LISTA GIGANTE DO USUÁRIO ---
CIDADES_BRUTAS = [
    "Guajará", "Juruá", "Manaquiri", "Maraã", "Amajari", "Alto Alegre", "Bonfim", "Caroebe", "Iracema", "Normandia", "São João da Baliza", "São Luiz", "Serra do Navio", "Augustinópolis", "Bom Jesus do Tocantins", "Crixás do Tocantins", "Itacajá", "Lagoa do Tocantins", "Lizarda", "Luzinópolis", "Oliveira de Fátima", "Ponte Alta do Bom Jesus", "Praia Norte", "Rio da Conceição", "Sampaio", "Santa Rosa do Tocantins", "Amapá do Maranhão", "Belágua", "Brejo", "Conceição do Lago-Açu", "Duque Bacelar", "Gonçalves Dias", "Humberto de Campos", "Igarapé do Meio", "Marajá do Sena", "Presidente Vargas", "Ribamar Fiquene", "São Francisco do Maranhão", "Acauã", "Amarante", "Antônio Almeida", "Aroazes", "Aroeiras do Itaim", "Barro Duro", "Belém do Piauí", "Bertolínia", "Bocaina", "Campo Grande do Piauí", "Campo Largo do Piauí", "Caridade do Piauí", "Curralinhos", "Demerval Lobão", "Fartura do Piauí", "Francisco Macedo", "Geminiano", "Ipiranga do Piauí", "Itainópolis", "Jardim do Mulato", "Júlio Borges", "Massapê do Piauí", "Miguel Alves", "Pio IX", "Santa Cruz do Piauí", "Santa Cruz dos Milagres", "Santana do Piauí", "Santa Rosa do Piauí", "Santo Antônio de Lisboa", "Santo Antônio dos Milagres", "São Julião", "São Lourenço do Piauí", "Tanque do Piauí", "Várzea Branca", "Araripe", "Barroquinha", "Caridade", "Potiretama", "Tauá", "Uruoca", "Doutor Severiano", "Luís Gomes", "Major Sales", "Paraná", "Riacho de Santana", "Tenente Ananias", "Venha-Ver", "Aguiar", "Borborema", "Casserengue", "Cruz do Espírito Santo", "Cuité de Mamanguape", "Frei Martinho", "Itapororoca", "Juarez Távora", "Livramento", "Pedras de Fogo", "Pilões", "Pirpirituba", "Serra da Raiz", "Tenório", "Calumbi", "Correntes", "Fernando de Noronha", "Itacuruba", "Primavera", "Vicência", "Atalaia", "Campo Grande", "Carneiros", "Feliz Deserto", "Mar Vermelho", "Olho d'Água das Flores", "Olho d'Água Grande", "Roteiro", "Santa Luzia do Norte", "Cedro de São João", "São Francisco", "Érico Cardoso", "Aiquara", "Antônio Gonçalves", "Banzaê", "Barro Alto", "Caldeirão Grande", "Catolândia", "Coronel João Sá", "Dário Meira", "Feira da Mata", "Filadélfia", "Floresta Azul", "Gavião", "Gongogi", "Igrapiúna", "Ipecaetá", "Irajuba", "Itaguaçu da Bahia", "Itatim", "Iuiú", "Jussiape", "Lajedão", "Lamarão", "Malhada", "Mascote", "Mucugê", "Nova Canaã", "Pé de Serra", "Presidente Jânio Quadros", "Rafael Jambeiro", "São José da Vitória", "Saubara", "Tanquinho", "Uibaí", "Açucena", "Água Boa", "Águas Formosas", "Alto Caparaó", "Alvarenga", "Angelândia", "Antônio Dias", "Araçaí", "Araújos", "Astolfo Dutra", "Baldim", "Barra Longa", "Bela Vista de Minas", "Berilo", "Biquinhas", "Bom Jesus do Galho", "Bonfim", "Bonito de Minas", "Brasilândia de Minas", "Bugre", "Buritis", "Cachoeira da Prata", "Caetanópolis", "Caeté", "Campanário", "Campo Florido", "Canápolis", "Cana Verde", "Cantagalo", "Capitão Andrade", "Caranaíba", "Carmo de Minas", "Carneirinho", "Cascalho Rico", "Catas Altas da Noruega", "Catuti", "Cedro do Abaeté", "Claraval", "Coluna", "Comercinho", "Conceição do Pará", "Cônego Marinho", "Consolação", "Corinto", "Coronel Fabriciano", "Coronel Murta", "Córrego do Bom Jesus", "Crisólita", "Cuparaque", "Datas", "Dionísio", "Divinésia", "Divinolândia de Minas", "Divisópolis", "Dom Bosco", "Entre Folhas", "Espírito Santo do Dourado", "Estiva", "Eugenópolis", "São Gonçalo do Rio Preto", "Felixlândia", "Fernandes Tourinho", "Formoso", "Fortaleza de Minas", "Francisco Badaró", "Franciscópolis", "Frei Gaspar", "Frei Inocêncio", "Frei Lagonegro", "Fronteira dos Vales", "Funilândia", "Gameleiras", "Glaucilândia", "Goiabeira", "Gonçalves", "Gouveia", "Guaraciama", "Heliodora", "Iapu", "Ibertioga", "Ibitiúra de Minas", "Ilicínea", "Inhaúma", "Inimutaba", "Ipaba", "Ipuiúna", "Itambé do Mato Dentro", "Itamogi", "Itamonte", "Itinga", "Itueta", "Jacuí", "Jenipapo de Minas", "Jequeri", "Jequitibá", "Jesuânia", "Joaíma", "Joanésia", "José Raydan", "Lagamar", "Lagoa dos Patos", "Lamim", "Laranjal", "Lassance", "Leandro Ferreira", "Leme do Prado", "Luisburgo", "Machacalis", "Malacacheta", "Maravilhas", "Mar de Espanha", "Mariana", "Marilac", "Mata Verde", "Materlândia", "Matias Barbosa", "Matias Cardoso", "Mato Verde", "Mendes Pimentel", "Moeda", "Monjolos", "Monte Formoso", "Montezuma", "Morada Nova de Minas", "Morro da Garça", "Morro do Pilar", "Munhoz", "Nacip Raydan", "Nova Belém", "Nova Era", "Nova Módica", "Nova Porteirinha", "Onça de Pitangui", "Orizânia", "Ouro Verde de Minas", "Padre Carvalho", "Paiva", "Papagaios", "Passabém", "Passa Tempo", "Pedra Dourada", "Pedrinópolis", "Pequi", "Perdigão", "Pescador", "Pingo-d'Água", "Piranguçu", "Planura", "Presidente Juscelino", "Prudente de Morais", "Queluzito", "Recreio", "Reduto", "Riachinho", "Rio Manso", "Rio Novo", "Rio Vermelho", "Rodeiro", "Salto da Divisa", "Santa Bárbara do Monte Verde", "Santa Cruz de Minas", "Santa Cruz do Escalvado", "Santa Efigênia de Minas", "Santa Fé de Minas", "Santa Juliana", "Santa Margarida", "Santa Maria do Salto", "Santana de Pirapama", "Santana do Riacho", "Santo Antônio do Grama", "Santo Hipólito", "São Francisco do Glória", "São Gonçalo do Pará", "São João das Missões", "São José da Safira", "São José da Varginha", "São José do Jacuri", "São Romão", "São Sebastião do Rio Preto", "São Sebastião do Rio Verde", "Sapucaí-Mirim", "Setubinha", "Sem-Peixe", "Senador Amaral", "Senador José Bento", "Senhora de Oliveira", "Serra Azul de Minas", "Serra dos Aimorés", "Silvianópolis", "Sobrália", "Taparuba", "Taquaraçu de Minas", "Tarumirim", "Turvolândia", "Umburatiba", "Vargem Alegre", "Varjão de Minas", "Vespasiano", "Virgem da Lapa", "Virgínia", "Vila Valério", "Cambuci", "Comendador Levy Gasparian", "Italva", "Laje do Muriaé", "Macuco", "Quatis", "Adolfo", "Águas de São Pedro", "Alambari", "Alfredo Marcondes", "Alto Alegre", "Alumínio", "Álvaro de Carvalho", "Alvinlândia", "Américo de Campos", "Anhembi", "Anhumas", "Aparecida", "Aparecida d'Oeste", "Areiópolis", "Ariranha", "Avaí", "Avanhandava", "Bananal", "Barra do Chapéu", "Biritiba-Mirim", "Bom Sucesso de Itararé", "Borborema", "Buritizal", "Caiabu", "Caiuá", "Cajobi", "Canas", "Cândido Rodrigues", "Cardoso", "Corumbataí", "Cosmorama", "Dirce Reis", "Dobrada", "Dolcinópolis", "Duartina", "Echaporã", "Elisiário", "Embaúba", "Estrela do Norte", "Fernando Prestes", "Gabriel Monteiro", "Gália", "Getulina", "Guaiçara", "Guará", "Guaraçaí", "Guararema", "Ibirá", "Ilha Comprida", "Indiana", "Indiaporã", "Ipeúna", "Ipiguá", "Irapuã", "Jaborandi", "Júlio Mesquita", "Lavínia", "Lourdes", "Lucianópolis", "Luís Antônio", "Lupércio", "Lutécia", "Marapoama", "Marinópolis", "Mendonça", "Miracatu", "Mira Estrela", "Mombuca", "Monte Alegre do Sul", "Monte Azul Paulista", "Monte Castelo", "Motuca", "Narandiba", "Neves Paulista", "Nova Aliança", "Nova Campina", "Nova Castilho", "Nova Granada", "Nova Guataporanga", "Nova Independência", "Novais", "Nova Luzitânia", "Onda Verde", "Oscar Bressane", "Palmares Paulista", "Panorama", "Paraíso", "Paulicéia", "Paulistânia", "Pereiras", "Piacatu", "Pirangi", "Populina", "Potirendaba", "Queluz", "Redenção da Serra", "Rincão", "Roseira", "Sabino", "Salto Grande", "Santa Adélia", "Santa Branca", "Santa Clara d'Oeste", "Santa Cruz da Conceição", "Santa Ernestina", "Santa Rita d'Oeste", "São João das Duas Pontes", "São João de Iracema", "São José do Barreiro", "Silveiras", "Sud Mennucci", "Suzanápolis", "Tabapuã", "Tabatinga", "Tapiratiba", "Tarabai", "Três Fronteiras", "Tupi Paulista", "Ubirajara", "Uchoa", "União Paulista", "Urupês", "Valentim Gentil", "Vera Cruz", "Viradouro", "Alto Piquiri", "Araruna", "Barbosa Ferraz", "Boa Esperança", "Bom Jesus do Sul", "Cambará", "Campina da Lagoa", "Centenário do Sul", "Cerro Azul", "Corumbataí do Sul", "Doutor Camargo", "Honório Serpa", "Ibema", "Icaraíma", "Iracema do Oeste", "Ivaté", "Jaguapitã", "Jardim Olinda", "Kaloré", "Lidianópolis", "Mangueirinha", "Marumbi", "Moreira Sales", "Nossa Senhora das Graças", "Palotina", "Peabiru", "Quarto Centenário", "Rio Branco do Ivaí", "Roncador", "Santa Cecília do Pavão", "Alfredo Wagner", "Armazém", "Bom Jesus", "Campo Alegre", "Campo Erê", "Coronel Martins", "Cunha Porã", "Cunhataí", "Lontras", "Praia Grande", "Romelândia", "Treviso", "Água Santa", "Anta Gorda", "Arambaré", "Arroio dos Ratos", "Arroio do Tigre", "Barão", "Barão de Cotegipe", "Barra do Ribeiro", "Benjamin Constant do Sul", "Boa Vista das Missões", "Boa Vista do Cadeado", "Bom Jesus", "Bom Progresso", "Boqueirão do Leão", "Cacique Doble", "Candiota", "Canudos do Vale", "Capitão", "Centenário", "Chiapetta", "Ciríaco", "Condor", "Coronel Pilar", "Cruzeiro do Sul", "Dois Irmãos das Missões", "Entre Rios do Sul", "Erval Seco", "Faxinalzinho", "Formigueiro", "Gaurama", "Guarani das Missões", "Harmonia", "Ibarama", "Ibiaçá", "Ibirapuitã", "Ipiranga do Sul", "Itatiba do Sul", "Jaboticaba", "Jacutinga", "Lagoão", "Lajeado do Bugre", "Mariana Pimentel", "Mata", "Minas do Leão", "Miraguaí", "Muliterno", "Nova Bassano", "Nova Pádua", "Novo Tiradentes", "Pantano Grande", "Paraíso do Sul", "Passa Sete", "Passo do Sobrado", "Pedras Altas", "Pinhal", "Poço das Antas", "Porto Xavier", "Putinga", "Roca Sales", "Rolador", "Salvador das Missões", "Santa Cecília do Sul", "Santa Maria do Herval", "São José do Ouro", "São José do Sul", "São Valentim", "Travesseiro", "Três Arroios", "Três Forquilhas", "Tunas", "Tupanci do Sul", "União da Serra", "Unistalda", "Vale Verde", "Vila Lângaro", "Aral Moreira", "Batayporã", "Camapuã", "Glória de Dourados", "Iguatemi", "Rochedo", "Tacuru", "Taquarussu", "Alto Paraguai", "Araguaiana", "Arenápolis", "Carlinda", "Castanheira", "Cocalinho", "Curvelândia", "Gaúcha do Norte", "Juscimeira", "Nossa Senhora do Livramento", "Nova Lacerda", "Novo São Joaquim", "Paranaíta", "Ponte Branca", "Ribeirãozinho", "São Pedro da Cipa", "Rosário Oeste", "São Félix do Araguaia", "Serra Nova Dourada", "Tesouro", "Abadiânia", "Americano do Brasil", "Anhanguera", "Cachoeira de Goiás", "Corumbá de Goiás", "Cumari", "Gouvelândia", "Hidrolina", "Inaciolândia", "Lagoa Santa", "Mairipotaba", "Moiporá", "Nova América", "Nova Iguaçu de Goiás", "Orizona", "Portelândia", "Rianápolis", "Rio Quente", "Santa Isabel", "Santa Rita do Novo Destino", "Santa Tereza de Goiás", "Santo Antônio de Goiás", "Urutaí", "Brasília"
]

def normalizar_texto(texto):
    if not isinstance(texto, str): return ""
    return ''.join(c for c in unicodedata.normalize('NFD', texto) if unicodedata.category(c) != 'Mn').upper().strip()

# Converte a lista gigante para um "Set" normalizado (Busca super rápida)
CIDADES_ALVO = set([normalizar_texto(c) for c in CIDADES_BRUTAS])

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
        "Licitanet": ["licitanet", "licitanet.com"], "Compras.Gov.Br": ["comprasnet", "compras.gov"],
        "Bll Compras": ["bll", "bll.org", "bllcompras"], "Portal de Compras Públicas": ["portal de compras publicas", " pcp "],
        "Bnc - Bolsa Nacional": ["bnc.org", "bolsa nacional", "bnccompras", "bnc"], "Licitar Digital": ["licitar digital"],
        "Licitações-e (BB)": ["licitacoes-e", "bb.com.br"], "Compras Br": ["comprasbr", "compras-br"],
        "BBMNET": ["bbmnet", "bbm"], "Start Gov": ["startgov"], "Br Conectado":["br conectado"], "Licita Mais": ["licitamais"],
        "Asm": ["asm.com"]
    }
    for nome_oficial, termos in portais.items():
        if any(termo in investigacao for termo in termos): return nome_oficial
    fonte = str(item.get('fonteSistema') or '').strip()
    if fonte and len(fonte) > 3 and not any(t in fonte.upper() for t in ["PNCP", "NULL", "NONE"]): return fonte.title()
    return "Outros"

def salvar_no_mysql(lista_dados):
    if not lista_dados: return
    sql = """
    INSERT IGNORE INTO licitacoes_raw 
    (id_pncp, cod_ibge, cidade_norm, uf, sistema_fonte, nome_orgao, data_publicacao, created_at)
    VALUES (:id_pncp, :cod_ibge, :cidade_norm, :uf, :sistema_fonte, :nome_orgao, :data_publicacao, :created_at)
    """
    try:
        with engine.begin() as conn: conn.execute(text(sql), lista_dados)
    except Exception as e: print(f"Erro ao salvar: {e}")

def coletar_em_lote():
    print(f"🚀 INICIANDO COLETA TOTAL EM LOTE ({len(CIDADES_ALVO)} MUNICÍPIOS ALVO)")
    print("⚠️ MODO CAPTURA TOTAL ATIVADO (Incluindo Fundos, Câmaras, Autarquias, etc.)\n")
    
    ESTADOS = ['AM','BA','ES','CE','GO','MA','MT','MS','PA','PB','PE','PR','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'] 
    MODALIDADES = [1, 4, 6, 7, 8]
    url = "https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao"
    
    data_inicio = datetime(2025, 1, 1)
    data_fim_absoluto = datetime(2026, 2, 20)
    
    total_injetado = 0
    
    for uf in ESTADOS:
        print(f"\n📍 Analisando o Estado: {uf}")
        
        data_atual = data_inicio
        while data_atual <= data_fim_absoluto:
            data_fim_semana = min(data_atual + timedelta(days=6), data_fim_absoluto)
            str_inicio = data_atual.strftime("%Y%m%d")
            str_fim = data_fim_semana.strftime("%Y%m%d")
            
            # 👇 O Bip do Radar Visual 👇
            sys.stdout.write(f"\r   ⏳ Varrendo a semana de {str_inicio[:4]}-{str_inicio[4:6]}-{str_inicio[6:]}... ")
            sys.stdout.flush()
            
            for mod in MODALIDADES:
                for pagina in range(1, 10):
                    params = {
                        "dataInicial": str_inicio, "dataFinal": str_fim, 
                        "uf": uf, "codigoModalidadeContratacao": mod, 
                        "pagina": pagina, "tamanhoPagina": 500
                    }
                    try:
                        r = requests.get(url, params=params, verify=False, timeout=15)
                        if r.status_code == 200:
                            dados = r.json().get('data', [])
                            if not dados: break 
                            
                            lista_salvar = []
                            for item in dados:
                                unidade = item.get('unidadeOrgao', {})
                                orgao = item.get('orgao', {})
                                cidade_item = normalizar_texto(unidade.get('municipioNome') or orgao.get('municipio', {}).get('nome', ''))
                                
                                if cidade_item in CIDADES_ALVO:
                                    nome_orgao = unidade.get('nomeUnidade') or orgao.get('razaoSocial', '')
                                    ibge = unidade.get('codigoIbge') or orgao.get('codigoIbge')
                                    
                                    if not ibge: continue
                                    
                                    lista_salvar.append({
                                        "id_pncp": str(item.get('numeroControlePNCP')), 
                                        "cidade_norm": cidade_item.title(),
                                        "uf": uf, 
                                        "sistema_fonte": detectar_plataforma(item), 
                                        "nome_orgao": nome_orgao[:200],
                                        "data_publicacao": item.get('dataPublicacaoPncp')[:19], 
                                        "cod_ibge": str(ibge),
                                        "created_at": datetime.now()
                                    })
                            
                            if lista_salvar:
                                salvar_no_mysql(lista_salvar)
                                total_injetado += len(lista_salvar)
                                # Quebra a linha pra não sobrescrever a mensagem de sucesso
                                sys.stdout.write(f"\n   🎯 Achou {len(lista_salvar)} alvo(s) em {uf}!\n")
                                
                        else: break
                    except: continue
                    time.sleep(0.1)
                    
            data_atual = data_fim_semana + timedelta(days=1)
            
    print(f"\n\n🏁 VARREDURA CONCLUÍDA! Um total de {total_injetado} licitações foram injetadas no banco.")
    print("⚠️ Lembre-se de rodar 'python 2_criar_views.py' logo em seguida.")

if __name__ == "__main__":
    coletar_em_lote()