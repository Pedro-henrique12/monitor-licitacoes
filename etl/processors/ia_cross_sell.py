import pandas as pd
from sqlalchemy import create_engine
import json
import os
import time
import requests
from dotenv import load_dotenv

# --- CONFIGURAÇÕES BÁSICAS ---
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CONFIG_PATH = os.path.join(BASE_DIR, 'config', '.env')
OUTPUT_DIR = os.path.join(BASE_DIR, 'data', 'output')
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Carrega as senhas e chaves
load_dotenv(CONFIG_PATH)
MYSQL_STR = os.getenv("MYSQL_STR")
API_KEY = os.getenv("GEMINI_API_KEY")

def descobrir_modelo_valido():
    """Consulta a API para descobrir qual modelo a sua chave tem permissão para usar hoje"""
    print("🔎 Verificando modelos liberados na sua chave do Google...")
    url = f"https://generativelanguage.googleapis.com/v1beta/models?key={API_KEY}"
    
    try:
        resp = requests.get(url)
        if resp.status_code == 200:
            modelos = resp.json().get('models', [])
            
            # 1º Tenta achar o Flash (mais rápido)
            for m in modelos:
                metodos = m.get('supportedGenerationMethods', [])
                nome = m.get('name', '')
                if 'generateContent' in metodos and 'flash' in nome.lower():
                    return nome
            
            # 2º Tenta achar o Pro (clássico)
            for m in modelos:
                metodos = m.get('supportedGenerationMethods', [])
                nome = m.get('name', '')
                if 'generateContent' in metodos and 'pro' in nome.lower():
                    return nome
                    
            # 3º Fallback: pega o primeiro que suporte geração de texto
            for m in modelos:
                if 'generateContent' in m.get('supportedGenerationMethods', []):
                    return m['name']
    except Exception as e:
        print(f"⚠️ Erro ao buscar lista de modelos: {e}")
        
    return "models/gemini-1.5-flash" # Fallback padrão se tudo falhar

def gerar_dossies_ia():
    print("🤖 Iniciando o Caçador de Cross-sell com IA...")
    
    # Descobre o modelo correto dinamicamente
    modelo_escolhido = descobrir_modelo_valido()
    print(f"✅ Modelo da IA detectado e validado: {modelo_escolhido}")
    
    engine = create_engine(MYSQL_STR)

    # 1. A QUERY DE OURO: Acha cidades onde Prefeitura = Licitanet, mas Câmara/Fundo = Outro
    query_cidades_ouro = """
    SELECT DISTINCT 
        p.cidade_norm AS Municipio, 
        p.uf AS Estado, 
        c.nome_orgao AS Alvo_Orgao, 
        c.sistema_fonte AS Alvo_Plataforma
    FROM licitacoes_raw p
    JOIN licitacoes_raw c ON p.cidade_norm = c.cidade_norm AND p.uf = c.uf
    WHERE p.sistema_fonte = 'Licitanet'
      AND (p.nome_orgao LIKE '%%PREFEITURA%%' OR p.nome_orgao LIKE '%%MUNICIPIO%%')
      AND c.sistema_fonte != 'Licitanet'
      AND (c.nome_orgao LIKE '%%CAMARA%%' OR c.nome_orgao LIKE '%%FUNDO%%')
      AND p.data_publicacao >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
    LIMIT 10 -- Limitamos a 10 no MVP
    """
    
    print("🔍 Buscando Cidades de Ouro no banco de dados...")
    df_alvos = pd.read_sql(query_cidades_ouro, engine)
    
    if df_alvos.empty:
        print("⚠️ Nenhum alvo encontrado com essa regra.")
        return

    resultados = []

    # 2. COMUNICAÇÃO DIRETA COM A API DO GOOGLE
    print(f"🧠 Gerando Dossiês Estratégicos para {len(df_alvos)} alvos...")
    
    # URL montada com o modelo correto que a gente descobriu ali em cima
    url = f"https://generativelanguage.googleapis.com/v1beta/{modelo_escolhido}:generateContent?key={API_KEY}"
    headers = {'Content-Type': 'application/json'}
    
    for index, row in df_alvos.iterrows():
        municipio = row['Municipio']
        estado = row['Estado']
        orgao_alvo = row['Alvo_Orgao']
        plataforma_atual = row['Alvo_Plataforma']
        
        print(f"   -> Analisando: {orgao_alvo} ({municipio}-{estado})")
        
        prompt = f"""
        Você é um estrategista de vendas B2B especialista em licitações públicas.
        Nosso agente de campo visitará fisicamente o seguinte órgão para tentar vender nosso software de licitações (Licitanet):
        - Órgão: {orgao_alvo}
        - Cidade: {municipio} - {estado}
        - O que eles usam hoje: {plataforma_atual}
        
        A vantagem matadora: A Prefeitura desta mesma cidade ({municipio}) já é nossa cliente e usa a Licitanet.
        
        Escreva um 'Dossiê de Bolso' direto e reto para o agente ler no carro antes da visita. 
        Forneça apenas 3 tópicos curtos em formato de lista focados em como convencer este órgão a unificar a plataforma com a Prefeitura.
        Não faça introduções ou conclusões, vá direto aos 3 tópicos.
        """
        
        payload = {
            "contents": [{"parts": [{"text": prompt}]}]
        }
        
        try:
            response = requests.post(url, headers=headers, json=payload)
            response_data = response.json()
            
            if response.status_code == 200:
                dossie_texto = response_data['candidates'][0]['content']['parts'][0]['text']
                
                resultados.append({
                    "Estado": estado,
                    "Municipio": municipio,
                    "Orgao_Alvo": orgao_alvo,
                    "Plataforma_Atual": plataforma_atual,
                    "Dossie_IA": dossie_texto
                })
            else:
                erro_msg = response_data.get('error', {}).get('message', 'Erro desconhecido na API')
                print(f"❌ Erro da API para {municipio}: {erro_msg}")
            
            # Pausa de 3 segundos para evitar bloqueio por volume de requisições na chave grátis
            time.sleep(3) 
            
        except Exception as e:
            print(f"❌ Falha de conexão ao gerar IA para {municipio}: {e}")

    # 3. SALVA O JSON COM A INTELIGÊNCIA
    path_ia = os.path.join(OUTPUT_DIR, 'rotas_ia.json')
    with open(path_ia, 'w', encoding='utf-8') as f:
        json.dump(resultados, f, ensure_ascii=False, indent=4)
        
    print("✅ Sucesso! rotas_ia.json gerado na pasta data/output/.")

if __name__ == "__main__":
    gerar_dossies_ia()