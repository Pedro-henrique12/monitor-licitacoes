import streamlit as st
import pandas as pd
from sqlalchemy import create_engine
import io

# --- 1. CONFIGURAÇÃO ---
st.set_page_config(page_title="Radar de Vendas - Licitanet", layout="wide")
MYSQL_STR = "mysql+mysqlconnector://root:root@localhost:3306/licitanet_db?charset=utf8mb4"

# --- 2. FUNÇÃO DE BUSCA NO BANCO ---
@st.cache_data(ttl=600) # Atualiza a cada 10 minutos
def buscar_orgaos_inativos():
    try:
        engine = create_engine(MYSQL_STR)
        
        # A Mágica do SQL: Agrupa pelo órgão, pega a última data e calcula a diferença em meses para hoje
        query = """
        SELECT 
            uf AS Estado,
            cidade_norm AS Municipio,
            nome_orgao AS Orgao,
            MAX(data_publicacao) AS Ultima_Publicacao,
            TIMESTAMPDIFF(MONTH, MAX(data_publicacao), CURDATE()) AS Meses_Inativo
        FROM licitacoes_raw
        GROUP BY uf, cidade_norm, nome_orgao
        HAVING Meses_Inativo >= 2
        ORDER BY Meses_Inativo DESC, uf ASC, cidade_norm ASC
        """
        df = pd.read_sql(query, engine)
        
        # Formata a data para ficar bonita na tela (DD/MM/AAAA)
        if not df.empty:
            df['Ultima_Publicacao'] = pd.to_datetime(df['Ultima_Publicacao']).dt.strftime('%d/%m/%Y')
            
        return df
    except Exception as e:
        st.error(f"Erro ao buscar dados: {e}")
        return pd.DataFrame()

def gerar_excel(df):
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='Alvos_Comerciais')
    return output.getvalue()

# --- 3. INTERFACE DO USUÁRIO ---
st.title("🎯 Radar Comercial - Órgãos Inativos")
st.markdown("Lista de prefeituras e órgãos que estão há meses sem publicar novos processos no PNCP.")
st.markdown("---")

df_alvos = buscar_orgaos_inativos()

if not df_alvos.empty:
    
    # --- FILTROS LATERAIS ---
    st.sidebar.header("📍 Filtros de Prospecção")
    
    # 1. Filtro de Tipo de Órgão 
    tipo_orgao_sel = st.sidebar.selectbox(
        "Filtrar por Tipo de Órgão:", 
        ["Todos", "Prefeitura/Município", "Câmaras", "Fundos/Secretarias", "Outros"]
    )
    
    # 2. Filtro de Estado
    lista_estados = ["Todos"] + sorted(df_alvos['Estado'].unique().tolist())
    estado_sel = st.sidebar.selectbox("Filtrar por Estado:", lista_estados)
    
    # 3. Filtro de tempo de inatividade
    meses_filtro = st.sidebar.slider(
        "Tempo sem publicar (em meses):", 
        min_value=2, 
        max_value=12, 
        value=(2, 12),
        help="Selecione 12 no lado direito para ver órgãos inativos há 1 ano ou mais."
    )
    
    # --- APLICANDO OS FILTROS ---
    if tipo_orgao_sel == "Prefeitura/Município":
        mask_pref = df_alvos['Orgao'].str.contains('PREFEITURA|MUNICÍPIO|MUNICIPIO', case=False, na=False)
        mask_excl = df_alvos['Orgao'].str.contains('CÂMARA|CAMARA|FUNDO|SECRETARIA|AUTARQUIA|INSTITUTO', case=False, na=False)
        df_alvos = df_alvos[mask_pref & ~mask_excl]
        
    elif tipo_orgao_sel == "Câmaras":
        df_alvos = df_alvos[df_alvos['Orgao'].str.contains('CÂMARA|CAMARA', case=False, na=False)]
        
    elif tipo_orgao_sel == "Fundos/Secretarias":
        df_alvos = df_alvos[df_alvos['Orgao'].str.contains('FUNDO|SECRETARIA|SAÚDE|SAUDE|ASSISTÊNCIA|ASSISTENCIA|EDUCAÇÃO|EDUCACAO', case=False, na=False)]
        
    elif tipo_orgao_sel == "Outros":
        mask_pref = df_alvos['Orgao'].str.contains('PREFEITURA|MUNICÍPIO|MUNICIPIO', case=False, na=False)
        mask_camara = df_alvos['Orgao'].str.contains('CÂMARA|CAMARA', case=False, na=False)
        mask_fundo = df_alvos['Orgao'].str.contains('FUNDO|SECRETARIA|SAÚDE|SAUDE|ASSISTÊNCIA|ASSISTENCIA|EDUCAÇÃO|EDUCACAO', case=False, na=False)
        df_alvos = df_alvos[~mask_pref & ~mask_camara & ~mask_fundo]

    if estado_sel != "Todos":
        df_alvos = df_alvos[df_alvos['Estado'] == estado_sel]
        
    mes_min, mes_max = meses_filtro
    if mes_max == 12:
        df_alvos = df_alvos[df_alvos['Meses_Inativo'] >= mes_min]
    else:
        df_alvos = df_alvos[(df_alvos['Meses_Inativo'] >= mes_min) & (df_alvos['Meses_Inativo'] <= mes_max)]
        
    # --- BOTÃO E MÉTRICA NA BARRA LATERAL ---
    st.sidebar.markdown("---")
    st.sidebar.metric(label="Alvos Encontrados", value=len(df_alvos))
    st.sidebar.download_button(
        label="📥 Baixar Planilha Comercial",
        data=gerar_excel(df_alvos),
        file_name="prospeccao_orgaos_inativos.xlsx",
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        use_container_width=True
    )

    # --- EXIBIÇÃO PRINCIPAL DA TABELA ---
    st.dataframe(
        df_alvos, 
        use_container_width=True, 
        hide_index=True,
        column_config={
            "Meses_Inativo": st.column_config.ProgressColumn(
                "Meses Inativo",
                help="Barra visual mostrando o tempo de inatividade",
                format="%d",
                min_value=0,
                max_value=12,
            ),
        }
    )
    
else:
    st.info("Nenhum dado encontrado ou o banco ainda está sendo alimentado.")