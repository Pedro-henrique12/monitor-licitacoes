from sqlalchemy import create_engine, text
import time
import os
from dotenv import load_dotenv

# Abre o cofre (.env)
load_dotenv()

# --- 1. CONFIGURAÇÕES ---
# Agora o Python vai puxar as chaves de forma segura e invisível
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
TABELA_ORIGEM = "licitacoes" 

MYSQL_STR = os.getenv("MYSQL_STR")
TABELA_DESTINO = "licitacoes_raw"

def criar_inteligencia_completa():
    print("🔌 Conectando ao MySQL (Modo AUTOCOMMIT)...")
    # AUTOCOMMIT é vital para evitar erros de sincronia
    engine = create_engine(MYSQL_STR, isolation_level="AUTOCOMMIT")
    
    sqls = [
        # 1. HIERARQUIA (Prefeitura > Câmara > Fundo)
        """
        CREATE OR REPLACE VIEW vw_licitacoes_pontuadas AS
        SELECT 
            cod_ibge, cidade_norm, uf, sistema_fonte,
            UPPER(nome_orgao) as orgao,
            CASE 
                WHEN UPPER(nome_orgao) LIKE '%PREFEITURA%' OR UPPER(nome_orgao) LIKE '%MUNIC%' THEN 1
                WHEN UPPER(nome_orgao) LIKE '%CAMARA%' OR UPPER(nome_orgao) LIKE '%CÂMARA%' THEN 2
                WHEN UPPER(nome_orgao) LIKE '%FUNDO%' THEN 3
                WHEN UPPER(nome_orgao) LIKE '%SECRET%' THEN 4
                ELSE 5
            END AS nivel_prioridade
        FROM licitacoes_raw;
        """,
        
        # 2. CONTAGEM
        """
        CREATE OR REPLACE VIEW vw_ranking_por_prioridade AS
        SELECT 
            cod_ibge, cidade_norm, uf, sistema_fonte, nivel_prioridade,
            COUNT(*) as qtd_votos
        FROM vw_licitacoes_pontuadas
        GROUP BY cod_ibge, cidade_norm, uf, sistema_fonte, nivel_prioridade;
        """,
        
        # 3. MAPA FINAL (CRIA A TABELA QUE ESTÁ FALTANDO)
        """
        CREATE OR REPLACE VIEW vw_mapa_final AS
        WITH 
        Podium AS (
            SELECT *,
                ROW_NUMBER() OVER(
                    PARTITION BY cod_ibge 
                    ORDER BY 
                        nivel_prioridade ASC, 
                        (CASE WHEN sistema_fonte = 'Outros' THEN 0 ELSE 1 END) DESC, 
                        qtd_votos DESC
                ) as posicao
            FROM vw_ranking_por_prioridade
        ),
        Estatisticas AS (
            SELECT 
                cod_ibge,
                COUNT(DISTINCT sistema_fonte) as qtd_plataformas,
                GROUP_CONCAT(CONCAT(sistema_fonte, ': ', total) ORDER BY total DESC SEPARATOR ' | ') as texto_detalhado
            FROM (
                SELECT cod_ibge, sistema_fonte, COUNT(*) as total 
                FROM licitacoes_raw 
                GROUP BY cod_ibge, sistema_fonte
            ) sub
            GROUP BY cod_ibge
        )
        SELECT 
            p.cod_ibge, 
            p.cidade_norm AS cidade, 
            p.uf, 
            p.sistema_fonte AS vencedor,
            p.nivel_prioridade,
            p.qtd_votos,
            
            -- Colunas cruciais para o app:
            e.texto_detalhado as resumo_disputa,
            CASE 
                WHEN e.qtd_plataformas > 1 THEN 'Compartilhado'
                ELSE 'Exclusivo'
            END as status_concorrencia,
            
            100 as confianca_perc
        FROM Podium p
        JOIN Estatisticas e ON p.cod_ibge = e.cod_ibge
        WHERE p.posicao = 1;
        """
    ]

    print("🧠 Recriando as regras de inteligência no banco...")
    
    for i, sql in enumerate(sqls):
        try:
            with engine.connect() as conn:
                conn.execute(text(sql))
                print(f"   ✅ Passo {i+1} OK.")
            time.sleep(0.5)
        except Exception as e:
            print(f"   ❌ Erro no passo {i+1}: {e}")
            break

if __name__ == "__main__":
    criar_inteligencia_completa()