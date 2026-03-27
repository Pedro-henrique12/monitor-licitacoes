from sqlalchemy import create_engine, text

# Conexão com o Banco MySQL
MYSQL_STR = "mysql+mysqlconnector://root:root@localhost:3306/licitanet_db?charset=utf8mb4"

def otimizar_banco():
    engine = create_engine(MYSQL_STR)
    
    # Comandos para alterar a estrutura da tabela (DDL)
    comandos_otimizacao = [
        # 1. UF: Como sempre são 2 letras, usamos CHAR(2) que é ultra rápido
        "ALTER TABLE licitacoes_raw MODIFY COLUMN uf CHAR(2);",
        
        # 2. SISTEMA: Limitando a 50 caracteres como seu gestor pediu
        "ALTER TABLE licitacoes_raw MODIFY COLUMN sistema_fonte VARCHAR(50);",
        
        # 3. CÓDIGO IBGE: Geralmente são 7 números, deixamos 15 por segurança
        "ALTER TABLE licitacoes_raw MODIFY COLUMN cod_ibge VARCHAR(15);",
        
        # 4. CIDADE: Nomes de cidade raramente passam de 100 letras
        "ALTER TABLE licitacoes_raw MODIFY COLUMN cidade_norm VARCHAR(100);",
        
        # 5. STATUS: 'Consolidado', 'Dividido' são pequenos
        # (Se essa coluna existir na tabela raw, se não, o script pula)
        # "ALTER TABLE licitacoes_raw MODIFY COLUMN status_municipio VARCHAR(20);" 
    ]

    print("🔧 Iniciando otimização das tabelas...")
    
    with engine.connect() as conn:
        for sql in comandos_otimizacao:
            try:
                conn.execute(text(sql))
                print(f"   ✅ Sucesso: {sql.split('MODIFY COLUMN')[1].strip()}")
            except Exception as e:
                # Se der erro (ex: algum dado for maior que o limite), ele avisa
                print(f"   ⚠️ Aviso: Não foi possível alterar uma coluna. Motivo: {e}")
                
    print("🏁 Otimização concluída! O banco está mais leve.")

if __name__ == "__main__":
    otimizar_banco()