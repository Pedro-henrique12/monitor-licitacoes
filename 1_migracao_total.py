import pandas as pd
from supabase import create_client, Client
from sqlalchemy import create_engine, text
import time

# --- 1. CONFIGURAÇÕES ---
SUPABASE_URL = "https://yhfbqtornyiitmpqurzp.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InloZmJxdG9ybnlpaXRtcHF1cnpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5MTg2MjEsImV4cCI6MjA4MTQ5NDYyMX0.XLBEGZJfh-04mWcUoHIM3ZVb5jjhigNd-qNLCkpb2UY"
TABELA_ORIGEM = "licitacoes" # Nome da sua tabela no Supabase

MYSQL_STR = "mysql+mysqlconnector://root:root@localhost:3306/licitanet_db"
TABELA_DESTINO = "licitacoes_raw"

# --- 2. CONEXÕES ---
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
engine = create_engine(MYSQL_STR)

def recriar_estrutura_banco():
    """Recria a tabela do zero com as colunas certas para a inteligência."""
    sql_create = f"""
    CREATE TABLE {TABELA_DESTINO} (
        id_pncp VARCHAR(100),
        cod_ibge VARCHAR(15),
        cidade_norm VARCHAR(100),
        uf CHAR(2),
        sistema_fonte VARCHAR(50),
        nome_orgao VARCHAR(255), -- ESSENCIAL PARA A VIEW FUNCIONAR
        data_publicacao DATETIME,
        created_at DATETIME
    );
    """
    
    print("🏗️ (Re)Criando tabela 'licitacoes_raw' no MySQL...")
    with engine.connect() as conn:
        try:
            conn.execute(text(f"DROP TABLE IF EXISTS {TABELA_DESTINO}"))
            conn.execute(text(sql_create))
            print("✅ Tabela criada com sucesso!")
        except Exception as e:
            print(f"❌ Erro ao criar tabela: {e}")

def migrar_tudao():
    recriar_estrutura_banco()
    
    print(f"🚀 INICIANDO MIGRAÇÃO (SUPABASE -> MYSQL)")
    
    offset = 0
    batch_size = 1000 # Limite do Supabase
    total_migrado = 0
    start_time = time.time()

    while True:
        try:
            # Baixa do Supabase
            response = supabase.table(TABELA_ORIGEM)\
                .select("id_pncp, cidade_norm, uf, sistema_fonte, nome_orgao, data_publicacao, created_at, cod_ibge")\
                .range(offset, offset + batch_size - 1)\
                .execute()
            
            dados = response.data
            if not dados: break
            
            df = pd.DataFrame(dados)
            
            # Tratamento de datas
            if 'data_publicacao' in df.columns:
                df['data_publicacao'] = pd.to_datetime(df['data_publicacao'], errors='coerce')
            if 'created_at' in df.columns:
                df['created_at'] = pd.to_datetime(df['created_at'], errors='coerce')

            # Insere no MySQL
            df.to_sql(TABELA_DESTINO, engine, if_exists='append', index=False, chunksize=1000)
            
            total_migrado += len(df)
            offset += batch_size
            
            tempo = round(time.time() - start_time, 2)
            print(f"📦 Baixados: {total_migrado} | Tempo: {tempo}s")
            
            if len(dados) < 1000: break
            
        except Exception as e:
            print(f"❌ Erro de conexão, tentando de novo... {e}")
            time.sleep(5)

    print("="*40)
    print(f"🏁 MIGRAÇÃO FINALIZADA! Total: {total_migrado}")
    print("👉 AGORA SIM: Rode o arquivo '2_criar_views.py'")

if __name__ == "__main__":
    migrar_tudao()