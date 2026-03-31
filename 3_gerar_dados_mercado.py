import pandas as pd
from sqlalchemy import create_engine
import json
import os
from dotenv import load_dotenv

# Abre o cofre (.env)
load_dotenv()

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
        
        with open('dados_mercado.json', 'w', encoding='utf-8') as f:
            json.dump(df_mapa.to_dict(orient='records'), f, ensure_ascii=False)
        print(f"✅ dados_mercado.json gerado.")

    # --- 2. ALERTAS DE CONCORRÊNCIA ---
    # (Mantido conforme as regras de interesse para prefeituras)
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
        with open('alertas.json', 'w', encoding='utf-8') as f:
            json.dump(df_alertas.to_dict(orient='records'), f, ensure_ascii=False)
        print(f"✅ alertas.json gerado.")
    except Exception as e: print(f"Erro nos alertas: {e}")

    # --- 3. RADAR COMERCIAL (ÓRGÃOS INDIVIDUALIZADOS POR CNPJ) ---
    print("Calculando Radar de Vendas (Inativos por CNPJ)...")
    
    # A MUDANÇA: Agrupamos pelo CNPJ COMPLETO (14 dígitos).
    # Isso separa Fundo de Saúde (CNPJ A) de Prefeitura (CNPJ B).
    query_radar = """
    SELECT 
        r.uf AS Estado,
        r.cidade_norm AS Municipio,
        
        -- Pega o nome mais recente usado por ESTE CNPJ específico
        SUBSTRING_INDEX(MAX(CONCAT(r.data_publicacao, '||', r.nome_orgao)), '||', -1) AS Orgao,
        
        MAX(r.data_publicacao) AS Ultima_Publicacao,
        TIMESTAMPDIFF(MONTH, MAX(r.data_publicacao), CURDATE()) AS Meses_Inativo,
        
        -- Pega a última plataforma usada por ESTE CNPJ específico
        SUBSTRING_INDEX(MAX(CONCAT(r.data_publicacao, '||', r.sistema_fonte)), '||', -1) AS Plataforma,
        
        -- Traz o CNPJ Completo para o seu vendedor saber exatamente quem é
        SUBSTRING_INDEX(r.id_pncp, '-', 1) AS CNPJ
        
    FROM licitacoes_raw r
    WHERE r.id_pncp IS NOT NULL AND r.id_pncp LIKE '%%-%%'
    GROUP BY 
        SUBSTRING_INDEX(r.id_pncp, '-', 1) -- AGRUPAMENTO POR CNPJ ÚNICO
    HAVING Meses_Inativo >= 2
    ORDER BY Meses_Inativo DESC, r.uf ASC, r.cidade_norm ASC
    """
    try:
        df_radar = pd.read_sql(query_radar, engine)
        if not df_radar.empty:
            df_radar['Ultima_Publicacao'] = pd.to_datetime(df_radar['Ultima_Publicacao']).dt.strftime('%d/%m/%Y')
        with open('radar.json', 'w', encoding='utf-8') as f:
            json.dump(df_radar.to_dict(orient='records'), f, ensure_ascii=False)
        print(f"✅ radar.json gerado com {len(df_radar)} registros individuais.")
    except Exception as e: print(f"Erro no radar: {e}")

if __name__ == "__main__":
    gerar_dados_mercado()