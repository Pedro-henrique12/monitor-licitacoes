import pandas as pd
from sqlalchemy import create_engine
import json
import os
from dotenv import load_dotenv

# --- LÓGICA DE CAMINHOS DINÂMICOS ---
# Pega a pasta onde o gerador.py está (etl/processors) e sobe duas para a raiz do projeto
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Define as pastas exatas
CONFIG_PATH = os.path.join(BASE_DIR, 'config', '.env')
OUTPUT_DIR = os.path.join(BASE_DIR, 'data', 'output')

# Garante que a pasta de saída exista
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Abre o arquivo de configuração (.env) lá na pasta config
load_dotenv(CONFIG_PATH)

# Puxa a string de conexão segura do MySQL
MYSQL_STR = os.getenv("MYSQL_STR")

def gerar_dados_mercado():
    print("Conectando ao banco para gerar dados do dashboard...")
    engine = create_engine(MYSQL_STR)
    
    # --- 1. DADOS DO MAPA ---
    print("Lendo view principal (vw_mapa_final)...")
    df_mapa = pd.read_sql("SELECT * FROM vw_mapa_final", engine)
    if not df_mapa.empty:
        df_mapa['cod_ibge'] = df_mapa['cod_ibge'].astype(str).str.strip().apply(lambda x: x.split('.')[0])
        df_mapa.rename(columns={'cidade': 'cidade_norm', 'vencedor': 'sistema_fonte', 'status_concorrencia': 'status_municipio'}, inplace=True)
        df_mapa['sistema_fonte'] = df_mapa['sistema_fonte'].fillna('Sem Dados no PNCP')
        df_mapa['status_municipio'] = df_mapa['status_municipio'].fillna('Sem Registro')
        df_mapa['resumo_disputa'] = df_mapa['resumo_disputa'].fillna('Nenhuma licitação encontrada.')
        
        path_mercado = os.path.join(OUTPUT_DIR, 'dados_mercado.json')
        with open(path_mercado, 'w', encoding='utf-8') as f:
            json.dump(df_mapa.to_dict(orient='records'), f, ensure_ascii=False)
        print(f"✅ dados_mercado.json gerado na pasta data/output/.")

    # --- 2. ALERTAS DE CONCORRÊNCIA ---
    print("Buscando alertas de concorrência...")
    query_alertas = """
    SELECT DISTINCT r.cidade_norm, r.uf, r.sistema_fonte AS sistema_concorrente, r.id_pncp, r.data_publicacao, r.nome_orgao
    FROM licitacoes_raw r
    WHERE r.sistema_fonte NOT IN ('Licitanet', 'Outros', 'Sem Dados no PNCP')
      AND r.data_publicacao >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      AND (r.nome_orgao LIKE '%%PREFEITURA%%' OR r.nome_orgao LIKE '%%MUNICIPIO%%')
      AND r.nome_orgao NOT LIKE '%%AUTARQUIA%%' AND r.nome_orgao NOT LIKE '%%FUNDO%%' AND r.nome_orgao NOT LIKE '%%CAMARA%%'
      AND r.nome_orgao NOT LIKE '%%SECRETARIA%%' AND r.nome_orgao NOT LIKE '%%SAUDE%%' AND r.nome_orgao NOT LIKE '%%AGUA%%' 
      AND EXISTS (
          SELECT 1 FROM licitacoes_raw l 
          WHERE l.cidade_norm = r.cidade_norm AND l.uf = r.uf AND l.sistema_fonte = 'Licitanet'
            AND l.data_publicacao >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
            AND (l.nome_orgao LIKE '%%PREFEITURA%%' OR l.nome_orgao LIKE '%%MUNICIPIO%%')
            AND l.nome_orgao NOT LIKE '%%AUTARQUIA%%' AND l.nome_orgao NOT LIKE '%%FUNDO%%' AND l.nome_orgao NOT LIKE '%%CAMARA%%'
      )
    ORDER BY r.data_publicacao DESC
    """
    try:
        df_alertas = pd.read_sql(query_alertas, engine)
        df_alertas['data_publicacao'] = df_alertas['data_publicacao'].astype(str)
        path_alertas = os.path.join(OUTPUT_DIR, 'alertas.json')
        with open(path_alertas, 'w', encoding='utf-8') as f:
            json.dump(df_alertas.to_dict(orient='records'), f, ensure_ascii=False)
        print(f"✅ alertas.json gerado na pasta data/output/.")
    except Exception as e: print(f"Erro nos alertas: {e}")

    print("Gerando dados do Radar Comercial...")
    
# ... (suas configurações de banco e geração da vw_mapa_final ficam aqui) ...

    # ====================================================================
    # 🎯 BLOCO DO RADAR COMERCIAL
    # ====================================================================
    print("Gerando dados do Radar Comercial...")
    
    query_radar = """
    SELECT 
        r.uf AS Estado,
        r.cidade_norm AS Municipio,
        SUBSTRING_INDEX(MAX(CONCAT(r.data_publicacao, '||', r.nome_orgao)), '||', -1) AS Orgao,
        MAX(r.data_publicacao) AS Ultima_Publicacao,
        TIMESTAMPDIFF(MONTH, MAX(r.data_publicacao), CURDATE()) AS Meses_Inativo,
        SUBSTRING_INDEX(MAX(CONCAT(r.data_publicacao, '||', r.sistema_fonte)), '||', -1) AS Plataforma,
        SUBSTRING_INDEX(r.id_pncp, '-', 1) AS CNPJ,
        SUBSTRING_INDEX(MAX(CONCAT(r.data_publicacao, '||', r.id_pncp)), '||', -1) AS Ultimo_ID_PNCP
    FROM licitacoes_raw r
    WHERE r.id_pncp IS NOT NULL AND r.id_pncp LIKE '%%-%%'
    GROUP BY 
        r.uf,
        r.cidade_norm,
        SUBSTRING_INDEX(r.id_pncp, '-', 1)
    HAVING Meses_Inativo >= 2
    ORDER BY Meses_Inativo DESC, r.uf ASC, r.cidade_norm ASC
    """

    try:
        df_radar = pd.read_sql(query_radar, engine)
        if not df_radar.empty:
            df_radar['Ultima_Publicacao'] = pd.to_datetime(df_radar['Ultima_Publicacao']).dt.strftime('%d/%m/%Y')
        path_radar = os.path.join(OUTPUT_DIR, 'radar.json')
        with open(path_radar, 'w', encoding='utf-8') as f:
            json.dump(df_radar.to_dict(orient='records'), f, ensure_ascii=False)
        print(f"✅ radar.json gerado com {len(df_radar)} registros.")
    except Exception as e: 
        print(f"❌ Erro no radar: {e}")


        print("Gerando dados de Histórico...")
    
    query_historico = """
    WITH Ranked AS (
        SELECT 
            uf, 
            cidade_norm AS municipio, 
            nome_orgao AS orgao, 
            data_publicacao, 
            sistema_fonte AS plataforma, 
            id_pncp,
            ROW_NUMBER() OVER(PARTITION BY uf, cidade_norm, nome_orgao ORDER BY data_publicacao DESC) as rn
        FROM licitacoes_raw
        WHERE id_pncp IS NOT NULL
    )
    SELECT uf, municipio, orgao, data_publicacao, plataforma, id_pncp 
    FROM Ranked 
    WHERE rn <= 10
    """

    try:
        df_hist = pd.read_sql(query_historico, engine)
        if not df_hist.empty:
            df_hist['data_publicacao'] = pd.to_datetime(df_hist['data_publicacao']).dt.strftime('%d/%m/%Y')
        path_hist = os.path.join(OUTPUT_DIR, 'historico.json')
        with open(path_hist, 'w', encoding='utf-8') as f:
            json.dump(df_hist.to_dict(orient='records'), f, ensure_ascii=False)
        print(f"✅ historico.json gerado com {len(df_hist)} registros.")
    except Exception as e: 
        print(f"❌ Erro no histórico: {e}")

if __name__ == "__main__":
    gerar_dados_mercado()