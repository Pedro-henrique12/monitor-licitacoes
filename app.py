import streamlit as st
import pandas as pd
import plotly.express as px
import io
import json
import os
from sqlalchemy import create_engine
from dotenv import load_dotenv

# CONFIGURAÇÃO DA PÁGINA
st.set_page_config(
    page_title="Monitor Licitações", 
    layout="wide", 
    initial_sidebar_state="expanded"
)

load_dotenv()

# Mantemos apenas o que realmente é usado no código abaixo
MYSQL_STR = os.getenv("MYSQL_STR")

# --- 3. FUNÇÕES AUXILIARES ---
def buscar_centro_geografico(geojson, cod_ibge_alvo):
    if not geojson: return None, None
    cod_ibge_alvo = str(cod_ibge_alvo).strip()
    
    for feature in geojson['features']:
        fid = str(feature.get('id', ''))
        if not fid: fid = str(feature.get('properties', {}).get('id', ''))
        
        if fid == cod_ibge_alvo:
            geometry = feature.get('geometry', {})
            coords = geometry.get('coordinates', [])
            tipo = geometry.get('type', '')
            try:
                if tipo == 'Polygon':
                    pts = coords[0]
                    return sum(p[1] for p in pts)/len(pts), sum(p[0] for p in pts)/len(pts)
                elif tipo == 'MultiPolygon':
                    maior_poly = max(coords, key=lambda x: len(x[0]))
                    pts = maior_poly[0]
                    return sum(p[1] for p in pts)/len(pts), sum(p[0] for p in pts)/len(pts)
            except Exception: # <- Corrigido o amarelo aqui
                return None, None
    return None, None

@st.cache_data
def carregar_geojson():
    caminhos = ["municipios_ibge.json/geojs-100-mun.json", "geojs-100-mun.json", "brasil.json"]
    for c in caminhos:
        if os.path.exists(c):
            try:
                with open(c, "r", encoding="utf-8") as f: return json.load(f)
            except Exception: # <- Corrigido o amarelo aqui
                pass
    return None

@st.cache_data(ttl=60)
def carregar_dados_banco():
    try:
        engine = create_engine(MYSQL_STR)
        query = "SELECT * FROM vw_mapa_final"
        df = pd.read_sql(query, engine)
        
        if df.empty: return pd.DataFrame()
        
        df['cod_ibge'] = df['cod_ibge'].astype(str).str.strip().apply(lambda x: x.split('.')[0])
        df.rename(columns={
            'cidade': 'cidade_norm', 
            'vencedor': 'sistema_fonte', 
            'status_concorrencia': 'status_municipio'
        }, inplace=True)
        
        return df.sort_values(['uf', 'cidade_norm'])
    except Exception as e:
        st.error(f"Erro ao conectar no banco: {e}")
        return pd.DataFrame()

@st.cache_data(ttl=300) # Atualiza a cada 5 minutos
def buscar_alertas_concorrencia():
    """Busca APENAS Prefeituras/Municípios clientes da Licitanet que publicaram em concorrentes nas últimas 48h"""
    try:
        engine = create_engine(MYSQL_STR)
        
        # Filtro: APENAS órgãos com 'PREFEITURA' ou 'MUNICIPIO' no nome
        query = """
        SELECT DISTINCT 
            r.cidade_norm, 
            r.uf, 
            r.sistema_fonte AS sistema_concorrente, 
            r.id_pncp,
            r.data_publicacao,
            r.nome_orgao
        FROM licitacoes_raw r
        WHERE r.sistema_fonte NOT IN ('Licitanet', 'Outros', 'Sem Dados no PNCP')
          AND r.data_publicacao >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
          
          -- 1. Regra para achar a Prefeitura
          AND (r.nome_orgao LIKE '%%PREFEITURA%%' OR r.nome_orgao LIKE '%%MUNICIPIO%%')
          AND r.nome_orgao NOT LIKE '%%AUTARQUIA%%'
          AND r.nome_orgao NOT LIKE '%%FUNDO%%'
          AND r.nome_orgao NOT LIKE '%%CAMARA%%'
          AND r.nome_orgao NOT LIKE '%%SECRETARIA%%'
          AND r.nome_orgao NOT LIKE '%%SAUDE%%'
          AND r.nome_orgao NOT LIKE '%%ASSISTENCIA%%'
          AND r.nome_orgao NOT LIKE '%%EDUCACAO%%'
          AND r.nome_orgao NOT LIKE '%%INSTITUTO%%'
          AND r.nome_orgao NOT LIKE '%%CONSORCIO%%'
          AND r.nome_orgao NOT LIKE '%%AGUA%%' -- Para barrar serviços de água/esgoto
          
          AND EXISTS (
              SELECT 1 FROM licitacoes_raw l 
              WHERE l.cidade_norm = r.cidade_norm 
                AND l.uf = r.uf 
                AND l.sistema_fonte = 'Licitanet'
                AND l.data_publicacao >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
                AND (l.nome_orgao LIKE '%%PREFEITURA%%' OR l.nome_orgao LIKE '%%MUNICIPIO%%')
                AND l.nome_orgao NOT LIKE '%%AUTARQUIA%%'
                AND l.nome_orgao NOT LIKE '%%FUNDO%%'
                AND l.nome_orgao NOT LIKE '%%CAMARA%%'
                AND l.nome_orgao NOT LIKE '%%SECRETARIA%%'
                AND l.nome_orgao NOT LIKE '%%SAUDE%%'
                AND l.nome_orgao NOT LIKE '%%ASSISTENCIA%%'
                AND l.nome_orgao NOT LIKE '%%EDUCACAO%%'
                AND l.nome_orgao NOT LIKE '%%INSTITUTO%%'
                AND l.nome_orgao NOT LIKE '%%CONSORCIO%%'
                AND l.nome_orgao NOT LIKE '%%AGUA%%'
          )
        ORDER BY r.data_publicacao DESC
        """
        return pd.read_sql(query, engine)
    except Exception as e:
        return pd.DataFrame()

def preencher_municipios_vazios(df_filtrado, geojson, uf_selecionada):
    if not geojson: return df_filtrado
    
    dic_uf = {'11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO', '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP', '41': 'PR', '42': 'SC', '43': 'RS', '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF'}
    
    ids, nomes = [], []
    for f in geojson['features']:
        cod = str(f.get('id', f.get('properties', {}).get('id', '')))[:7]
        nome = f.get('properties', {}).get('name', f.get('properties', {}).get('NM_MUN', 'Desconhecido'))
        if cod:
            ids.append(cod)
            nomes.append(nome)
            
    df_esqueleto = pd.DataFrame({'cod_ibge': ids, 'cidade_mapa': nomes})
    df_esqueleto['uf_mapa'] = df_esqueleto['cod_ibge'].str[:2].map(dic_uf)
    
    if uf_selecionada != "Todos":
        df_esqueleto = df_esqueleto[df_esqueleto['uf_mapa'] == uf_selecionada]
        
    if not df_filtrado.empty:
        df_final = pd.merge(df_esqueleto, df_filtrado, on='cod_ibge', how='left')
    else:
        df_final = df_esqueleto.copy()
        for col in ['sistema_fonte', 'status_municipio', 'resumo_disputa', 'cidade_norm', 'uf']:
            df_final[col] = None

    df_final['cidade_norm'] = df_final['cidade_norm'].fillna(df_final['cidade_mapa'])
    df_final['uf'] = df_final['uf'].fillna(df_final['uf_mapa'])
    df_final['sistema_fonte'] = df_final['sistema_fonte'].fillna('Sem Dados no PNCP')
    df_final['status_municipio'] = df_final['status_municipio'].fillna('Sem Registro')
    df_final['resumo_disputa'] = df_final['resumo_disputa'].fillna('Nenhuma licitação encontrada no PNCP para os filtros atuais.')
    
    return df_final

def gerar_excel(df):
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        cols = {'uf': 'UF', 'cidade_norm': 'Município', 'sistema_fonte': 'Plataforma', 'status_municipio': 'Status', 'resumo_disputa': 'Detalhamento'}
        df_ex = df[list(cols.keys())].rename(columns=cols) if not df.empty else df
        df_ex.to_excel(writer, index=False)
    return output.getvalue()

#CARREGAMENTO INICIAL 
geojson = carregar_geojson()
df_banco = carregar_dados_banco()

df_filtrado = pd.DataFrame()
uf_sel = "Todos"
cidade_sel = "Todos"

CORES_SISTEMAS = {
    "Licitanet": "#FFD700", "Bll Compras": "#FF8C00", "Compras.Gov.Br": "#FF0000",
    "BBMNET": "#FF1493", "Br Conectado": "#800000", "Licitações-e (BB)": "#000080",
    "Pncp": "#4169E1", "Bnc - Bolsa Nacional": "#87CEEB", "Compras Br": "#00CED1",
    "Licitar Digital": "#008000", "Licita Mais": "#32CD32", "Conlicitacao": "#2E8B57",
    "Portal de Compras Públicas": "#8A2BE2", "Start Gov": "#8B4513",
    "Sem Dados no PNCP": "#E0E0E0", # Cor para vazios
    "Outros": "#A9A9A9"
}

# BARRA LATERAL 
st.sidebar.header("📍 Filtros de Análise")

if not df_banco.empty:
    lista_ufs = sorted(df_banco['uf'].dropna().unique())
    uf_sel = st.sidebar.selectbox("Filtrar Estado:", ["Todos"] + lista_ufs)

    if uf_sel != "Todos":
        df_filtrado = df_banco[df_banco['uf'] == uf_sel]
        lista_cidades = sorted(df_filtrado['cidade_norm'].dropna().unique())
        cidade_sel = st.sidebar.selectbox("Filtrar Município:", ["Todos"] + lista_cidades)
        if cidade_sel != "Todos":
            df_filtrado = df_filtrado[df_filtrado['cidade_norm'] == cidade_sel]
    else:
        df_filtrado = df_banco.copy()

df_para_mapa = preencher_municipios_vazios(df_filtrado, geojson, uf_sel)

st.sidebar.markdown("---")
st.sidebar.metric("Cidades com Dados", len(df_filtrado) if not df_filtrado.empty else 0)
st.sidebar.metric("Cidades no Mapa", len(df_para_mapa))
st.sidebar.download_button("📥 Baixar Relatório", gerar_excel(df_para_mapa), "relatorio.xlsx", use_container_width=True)

# --- 6. VISUALIZAÇÃO PRINCIPAL ---
st.title("🗺️ Monitor de Licitações")

# BLOCO DE ALERTAS 
df_alertas = buscar_alertas_concorrencia()
if not df_alertas.empty:
    st.error(f"🚨Identificamos {len(df_alertas)} Prefeitura(s) da base publicando em outros sistemas nas últimas 48h!")
    with st.expander("⚠️ Clique aqui para ver os detalhes dos alertas", expanded=True):
        for index, row in df_alertas.iterrows():
            st.warning(
                f"📍 **{row['cidade_norm']} - {row['uf']}** | 🏛️ Órgão: **{row['nome_orgao']}**\n\n"
                f"Utilizou o portal **{row['sistema_concorrente']}** "
                f"| Publicado em: `{str(row['data_publicacao'])[:10]}` | ID PNCP: `{row['id_pncp']}`"
            )
st.markdown("---")


if not df_para_mapa.empty and geojson:
    centro_mapa = {"lat": -15.78, "lon": -47.93}
    zoom_level = 3.5
    
    if cidade_sel != "Todos":
        ibge_alvo = df_para_mapa.iloc[0]['cod_ibge']
        lat, lon = buscar_centro_geografico(geojson, ibge_alvo)
        if lat:
            centro_mapa = {"lat": lat, "lon": lon}
            zoom_level = 10.5
    elif uf_sel != "Todos":
        zoom_level = 5.0

    fig_mapa = px.choropleth_mapbox(
        df_para_mapa,
        geojson=geojson,
        locations="cod_ibge",
        featureidkey="id" if "id" in geojson['features'][0] else "properties.id",
        color="sistema_fonte",
        color_discrete_map=CORES_SISTEMAS,
        mapbox_style="carto-positron",
        zoom=zoom_level,
        center=centro_mapa,
        opacity=0.9,
        hover_name="cidade_norm",
        hover_data={"sistema_fonte": True, "status_municipio": True, "resumo_disputa": True, "cod_ibge": False}
    )
    fig_mapa.update_layout(margin={"r":0,"t":0,"l":0,"b":0}, height=600)
    st.plotly_chart(fig_mapa, use_container_width=True)

    # DASHBOARD INFERIOR 
    st.markdown("---")
    st.subheader(f"📊 Análise Estatística - {uf_sel if uf_sel != 'Todos' else 'Brasil'}")

    col1, col2 = st.columns(2)

    with col1:
        st.markdown("**Plataformas**")
        df_pizza1 = df_para_mapa[df_para_mapa['sistema_fonte'] != 'Sem Dados no PNCP']
        if not df_pizza1.empty:
            df_pizza = df_pizza1['sistema_fonte'].value_counts().reset_index()
            df_pizza.columns = ['Plataforma', 'Total']
            fig1 = px.pie(df_pizza, values='Total', names='Plataforma', color='Plataforma', color_discrete_map=CORES_SISTEMAS, hole=0.4)
            st.plotly_chart(fig1, use_container_width=True)
        else:
            st.info("Sem dados suficientes para o gráfico.")

    with col2:
        st.markdown("**⚔️ Concorrência (Exclusivo vs Compartilhado)**")
        df_pizza2 = df_para_mapa[df_para_mapa['status_municipio'] != 'Sem Registro']
        if not df_pizza2.empty:
            df_p2 = df_pizza2['status_municipio'].value_counts().reset_index()
            df_p2.columns = ['Status', 'Total']
            fig2 = px.pie(df_p2, values='Total', names='Status', color='Status', color_discrete_map={'Exclusivo': '#2E8B57', 'Compartilhado': '#4682B4'}, hole=0.4)
            st.plotly_chart(fig2, use_container_width=True)
        else:
            st.info("Sem dados suficientes para o gráfico.")
else:
    st.info("Aguardando mapa ou dados...")