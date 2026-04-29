const { createApp, markRaw, nextTick } = Vue;

const CORES_SISTEMAS = {
    "Licitanet": "#FFD700", "Bll Compras": "#003a24", "Compras.Gov.Br": "#FF0000",
    "BBMNET": "#FF1493", "Br Conectado": "#800000", "Licitações-e (BB)": "#000080",
    "Bnc - Bolsa Nacional": "#87CEEB", "Compras Br": "#00CED1",
    "Licitar Digital": "#008000", "Licita Mais": "#32CD32", "Conlicitacao": "#2E8B57",
    "Portal de Compras Públicas": "#8A2BE2", "Start Gov": "#8B4513",
    "Sem Dados no PNCP": "#444444", // Escureci o Sem Dados para combinar
    "Outros": "#A9A9A9"     
};

Chart.defaults.color = '#a0aabf';

createApp({
    data() {
        return {
            abaAtiva: 'mapa', dadosMercado: [], dadosFiltrados: [], alertas: [], alertasFiltrados: [], 
            geoJsonDados: null, dadosHistorico: [], mapa: null, camadaGeoJson: null, camadaEstados: null,
            geoJsonEstados: null, graficoPlat: null, graficoConc: null, ufsSelecionadas: ['Todos'], 
            cidadeSelecionada: 'Todos', buscaCidade: '', listaUFs: [], listaCidades: [], 
            coresSistemas: CORES_SISTEMAS, dadosRadar: [], dadosRadarFiltrados: [], 
            radarTipoOrgao: 'Todos', radarMeses: 2, radarPlataforma: 'Todas', listaPlataformasRadar: [],
            alertasExpandidos: false, paginaAtualRadar: 1, itensPorPagina: 50
        }
    },
    computed: {
        historicoFiltrado() {
            if (this.cidadeSelecionada === 'Todos' || this.ufsSelecionadas.includes('Todos') || this.ufsSelecionadas.length > 1) return {};
            
            // Filtro rígido por UF e Município
            const dadosCidade = this.dadosHistorico.filter(h => 
                h.uf === this.ufsSelecionadas[0] && h.municipio === this.cidadeSelecionada
            );
            
            const agrupado = {};
            dadosCidade.forEach(item => {
                if (!agrupado[item.orgao]) agrupado[item.orgao] = [];
                agrupado[item.orgao].push(item);
            });
            return agrupado;
        },
        // ... (outros computeds como cidadesFiltradasNaBusca, radarPaginado, etc)
    },
    methods: {
        async mudarAba(novaAba) {
            this.abaAtiva = novaAba;
            await nextTick();
            if (novaAba === 'mapa' && this.mapa) this.mapa.invalidateSize();
            if (novaAba === 'dashboards') this.atualizarDashboards();
            if (novaAba === 'radar') this.filtrarRadar();
        },
        async carregarArquivos() {
            try {
                const [resAlertas, resDados, resGeo, resEstados, resHist, resRadar] = await Promise.all([
                    fetch('../data/output/alertas.json'), fetch('../data/output/dados_mercado.json'),
                    fetch('../data/geo/municipios_ibge.json/geojs-100-mun.json'),
                    fetch('https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/brazil-states.geojson'),
                    fetch('../data/output/historico.json'), fetch('../data/output/radar.json')
                ]);
                
                if (resDados.ok) this.dadosMercado = await resDados.json();
                if (resHist.ok) this.dadosHistorico = await resHist.json();
                if (resRadar.ok) {
                    this.dadosRadar = await resRadar.json();
                    this.listaPlataformasRadar = [...new Set(this.dadosRadar.map(i => i.Plataforma))].sort();
                }
                // ... (restante do carregamento de GeoJSON e Alertas)
                this.prepararFiltros();
                this.filtrarDados();
            } catch (e) { console.error(e); }
        },
        // ... (restante dos métodos: filtrarDados, renderizarPoligonos, gerarLinkPNCP, etc)
    }
}).mount('#app');