from sqlalchemy import create_engine, text
import pandas as pd

# Conexão
MYSQL_STR = "mysql+mysqlconnector://root:root@localhost:3306/licitanet_db?charset=utf8mb4"
engine = create_engine(MYSQL_STR)

def diagnosticar():
    print("🕵️ INICIANDO DIAGNÓSTICO DO BANCO DE DADOS...\n")
    
    with engine.connect() as conn:
        # 1. Verifica Tabela Bruta
        try:
            qtd_raw = conn.execute(text("SELECT COUNT(*) FROM licitacoes_raw")).scalar()
            print(f"1️⃣  Tabela Bruta (licitacoes_raw): {qtd_raw} linhas.")
            if qtd_raw == 0:
                print("   ❌ ERRO CRÍTICO: O banco está vazio! O problema foi na Migração ou no Coletor.")
            else:
                print("   ✅ Dados brutos OK.")
        except Exception as e:
            print(f"   ❌ ERRO: Tabela 'licitacoes_raw' não existe! ({e})")

        # 2. Verifica Inteligência (View)
        try:
            qtd_view = conn.execute(text("SELECT COUNT(*) FROM vw_mapa_final")).scalar()
            print(f"2️⃣  Tabela Inteligente (vw_mapa_final): {qtd_view} linhas.")
            if qtd_view == 0 and qtd_raw > 0:
                print("   ❌ ERRO: A View existe mas está vazia. O script '2_criar_views.py' precisa ser rodado novamente.")
            elif qtd_view > 0:
                print("   ✅ Inteligência OK. Se o App não mostra, é filtro de data/estado.")
        except Exception as e:
            print(f"   ❌ ERRO: A View 'vw_mapa_final' não existe! Rode 'python 2_criar_views.py'.")

if __name__ == "__main__":
    diagnosticar()