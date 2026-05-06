const { createApp, markRaw, nextTick } = Vue;

const CORES_SISTEMAS = {
    "Licitanet": "#FFD700", "Bll Compras": "#003a24", "Compras.Gov.Br": "#FF0000",
    "BBMNET": "#FF1493", "Br Conectado": "#800000", "Licitações-e (BB)": "#000080",
    "Bnc - Bolsa Nacional": "#87CEEB", "Compras Br": "#00CED1",
    "Licitar Digital": "#008000", "Licita Mais": "#32CD32", "Conlicitacao": "#2E8B57",
    "Portal de Compras Públicas": "#8A2BE2", "Start Gov": "#8B4513",
    "Sem Dados no PNCP": "#444444", 
    "Outros": "#A9A9A9"  
};

Chart.defaults.color = '#a0aabf';

createApp({
    data() {
        return {
            abaAtiva: 'mapa', 
            dadosIA: [],
            dadosMercado: [], dadosFiltrados: [], alertas: [], alertasFiltrados: [], geoJsonDados: null,
            dadosHistorico: [], 
            mapa: null, camadaGeoJson: null, camadaEstados: null, geoJsonEstados: null, graficoPlat: null, graficoConc: null,
            ufsSelecionadas: ['Todos'], cidadeSelecionada: 'Todos', buscaCidade: '', 
            listaUFs: [], listaCidades: [], coresSistemas: CORES_SISTEMAS,
            dadosRadar: [], dadosRadarFiltrados: [], radarTipoOrgao: 'Todos', radarMeses: 2, radarPlataforma: 'Todas', listaPlataformasRadar: [],
            alertasExpandidos: false, paginaAtualRadar: 1, itensPorPagina: 50,
            
            // --- PLANEJADOR DE ROTAS ---
            planejadorUF: '',
            planejadorBuscaCidade: '',
            rotaEmPlanejamento: { passos: [] },
            novaCidadeRota: {
                municipio: '', uf: '', km_estrada: 0, km_cidade: 0,
                vr_hospedagem: 0, vr_jantar: 0, orgaosDisponiveis: [], orgaosSelecionados: []
            }
        }
    },
    computed: {
        // FILTROS GLOBAIS
        cidadesFiltradasNaBusca() {
            if (!this.buscaCidade) return this.listaCidades;
            return this.listaCidades.filter(c => c.toLowerCase().includes(this.buscaCidade.toLowerCase()));
        },
        // FILTRO EXCLUSIVO DO PLANEJADOR
        cidadesFiltradasPlanejador() {
            if (!this.planejadorUF) return [];
            // Pega as cidades do estado selecionado no dadosMercado
            const cidadesEstado = [...new Set(this.dadosMercado.filter(d => d.uf === this.planejadorUF).map(d => d.cidade_norm))].sort();
            if (!this.planejadorBuscaCidade) return cidadesEstado;
            return cidadesEstado.filter(c => c.toLowerCase().includes(this.planejadorBuscaCidade.toLowerCase()));
        },
        textoEstadosSelecionados() {
            if (this.ufsSelecionadas.includes('Todos') || this.ufsSelecionadas.length === 0) return 'Todos';
            return this.ufsSelecionadas.length <= 3 ? this.ufsSelecionadas.join(', ') : `${this.ufsSelecionadas.length} selecionados`;
        },
        plataformaLider() {
            if(this.dadosFiltrados.length === 0) return '-';
            const contagem = {};
            this.dadosFiltrados.forEach(d => { if(d.sistema_fonte !== 'Sem Dados no PNCP') contagem[d.sistema_fonte] = (contagem[d.sistema_fonte] || 0) + 1; });
            const sorted = Object.keys(contagem).sort((a,b) => contagem[b] - contagem[a]);
            return sorted[0] || '-';
        },
        percentualExclusivo() {
            const total = this.dadosFiltrados.filter(d => d.status_municipio !== 'Sem Registro').length;
            if(total === 0) return '0';
            const exclusivos = this.dadosFiltrados.filter(d => d.status_municipio === 'Exclusivo').length;
            return ((exclusivos / total) * 100).toFixed(1);
        },
        radarPaginado() {
            const inicio = (this.paginaAtualRadar - 1) * this.itensPorPagina;
            return this.dadosRadarFiltrados.slice(inicio, inicio + this.itensPorPagina);
        },
        totalPaginasRadar() { return Math.ceil(this.dadosRadarFiltrados.length / this.itensPorPagina) || 1; },
        historicoFiltrado() {
            if (this.cidadeSelecionada === 'Todos' || this.ufsSelecionadas.length !== 1) return {};
            const agrupado = {};
            this.dadosHistorico.filter(h => h.uf === this.ufsSelecionadas[0] && h.municipio === this.cidadeSelecionada).forEach(item => {
                if (!agrupado[item.orgao]) agrupado[item.orgao] = [];
                agrupado[item.orgao].push(item);
            });
            return agrupado;
        },
        calcularTotalKM() { return this.rotaEmPlanejamento.passos.reduce((acc, p) => acc + parseFloat(p.km_total || 0), 0); },
        calcularTotalCustos() { return this.rotaEmPlanejamento.passos.reduce((acc, p) => acc + parseFloat(p.vr_hospedagem || 0) + parseFloat(p.vr_jantar || 0), 0).toFixed(2); }
    },
    async mounted() {
        this.iniciarMapa();
        await this.carregarArquivos();
    },
    methods: {
        async mudarAba(novaAba) {
            this.abaAtiva = novaAba;
            await nextTick(); 
            if (novaAba === 'mapa' && this.mapa) this.mapa.invalidateSize(); 
            if (novaAba === 'dashboards') this.atualizarDashboards();
        },
        iniciarMapa() {
            if (document.getElementById('map') && !this.mapa) {
                this.mapa = markRaw(L.map('map', { preferCanvas: true }).setView([-15.7801, -47.9292], 4));
                L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', { opacity: 0.9 }).addTo(this.mapa);
            }
        },
        async carregarArquivos() {
            try {
                const [resAlertas, resDados, resGeo, resEstados, resHist, resIA, resRadar] = await Promise.all([
                    fetch('../data/output/alertas.json'), fetch('../data/output/dados_mercado.json'), 
                    fetch('../data/geo/municipios_ibge.json/geojs-100-mun.json'),
                    fetch('https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/brazil-states.geojson'),
                    fetch('../data/output/historico.json'), fetch('../data/output/rotas_ia.json'), fetch('../data/output/radar.json')
                ]);
                if (resAlertas.ok) this.alertas = await resAlertas.json();
                if (resDados.ok) this.dadosMercado = await resDados.json();
                if (resGeo.ok) this.geoJsonDados = markRaw(await resGeo.json());
                if (resEstados.ok) { this.geoJsonEstados = markRaw(await resEstados.json()); this.renderizarEstados(); }
                if (resHist.ok) this.dadosHistorico = await resHist.json();
                if (resIA.ok) this.dadosIA = await resIA.json();
                if (resRadar.ok) this.dadosRadar = await resRadar.json();
                this.prepararFiltros();
                this.filtrarDados(); 
            } catch (erro) { console.error("Erro no carregamento:", erro); }
        },
        prepararFiltros() { this.listaUFs = [...new Set(this.dadosMercado.map(item => item.uf))].sort(); },
        tratarSelecaoUFs(clicado) {
            if (clicado === 'Todos') this.ufsSelecionadas = ['Todos'];
            else { const idx = this.ufsSelecionadas.indexOf('Todos'); if (idx > -1) this.ufsSelecionadas.splice(idx, 1); }
            if (this.ufsSelecionadas.length === 0) this.ufsSelecionadas = ['Todos'];
            this.filtrarDados();
        },
        selecionarCidade(c) { this.cidadeSelecionada = c; this.filtrarDados(); },
        filtrarDados() {
            this.dadosFiltrados = this.ufsSelecionadas.includes('Todos') ? this.dadosMercado : this.dadosMercado.filter(d => this.ufsSelecionadas.includes(d.uf));
            this.listaCidades = this.ufsSelecionadas.length === 1 ? [...new Set(this.dadosFiltrados.map(d => d.cidade_norm))].sort() : [];
            if (this.cidadeSelecionada !== 'Todos') this.dadosFiltrados = this.dadosFiltrados.filter(d => d.cidade_norm === this.cidadeSelecionada);
            this.alertasFiltrados = this.alertas.filter(a => (this.ufsSelecionadas.includes('Todos') || this.ufsSelecionadas.includes(a.uf)) && (this.cidadeSelecionada === 'Todos' || a.cidade_norm === this.cidadeSelecionada));
            if (this.abaAtiva === 'mapa') this.renderizarPoligonos();
            this.filtrarRadar();
        },
        filtrarRadar() {
            let f = this.dadosRadar || [];
            if (!this.ufsSelecionadas.includes('Todos')) f = f.filter(d => this.ufsSelecionadas.includes(d.Estado));
            this.dadosRadarFiltrados = f;
        },
        renderizarEstados() {
            if (this.geoJsonEstados && this.mapa) L.geoJSON(this.geoJsonEstados, { style: { color: '#ffffff', weight: 1.5, fillOpacity: 0, interactive: false } }).addTo(this.mapa);
        },
        renderizarPoligonos() {
            if (!this.geoJsonDados || !this.mapa) return;
            if (this.camadaGeoJson) this.mapa.removeLayer(this.camadaGeoJson);
            const mapDados = {}; this.dadosFiltrados.forEach(d => { if(d.cod_ibge) mapDados[String(d.cod_ibge).substring(0,6)] = d; });
            this.camadaGeoJson = markRaw(L.geoJSON(this.geoJsonDados, {
                style: (f) => ({ fillColor: CORES_SISTEMAS[mapDados[String(f.id || f.properties.id || f.properties.cod_ibge).substring(0,6)]?.sistema_fonte] || '#444', weight: 0.5, color: '#111', fillOpacity: 0.9 }),
                onEachFeature: (f, l) => {
                    const d = mapDados[String(f.id || f.properties.id || f.properties.cod_ibge).substring(0,6)];
                    l.bindPopup(`<b>${d ? d.cidade_norm : f.properties.name}</b><br>Plataforma: ${d ? d.sistema_fonte : 'Sem Dados'}`);
                }
            })).addTo(this.mapa);
        },
        formatarTextoIA(t) { return t?.replace(/\*\*(.*?)\*\*/g, '<strong class="text-warning">$1</strong>').replace(/\n?\s*\*\s/g, '<br><br>🎯 ') || ''; },
        
        // MÉTODOS DO PLANEJADOR
        selecionarCidadePlanejador(c) {
            this.novaCidadeRota.municipio = c;
            this.novaCidadeRota.uf = this.planejadorUF;
            const licitacoes = this.dadosHistorico.filter(d => d.municipio === c && d.uf === this.planejadorUF);
            const orgaos = {};
            licitacoes.forEach(l => { if (!orgaos[l.orgao]) orgaos[l.orgao] = { nome_orgao: l.orgao, sistema_fonte: l.plataforma }; });
            this.novaCidadeRota.orgaosDisponiveis = Object.values(orgaos);
            this.novaCidadeRota.orgaosSelecionados = [];
        },
        adicionarCidadeARota() {
            this.rotaEmPlanejamento.passos.push({
                ...this.novaCidadeRota,
                km_total: parseFloat(this.novaCidadeRota.km_estrada) + parseFloat(this.novaCidadeRota.km_cidade),
                orgaosSelecionados: [...this.novaCidadeRota.orgaosSelecionados]
            });
            this.novaCidadeRota = { municipio: '', uf: '', km_estrada: 0, km_cidade: 0, vr_hospedagem: 0, vr_jantar: 0, orgaosDisponiveis: [], orgaosSelecionados: [] };
            this.planejadorBuscaCidade = '';
        },
        removerPasso(i) { this.rotaEmPlanejamento.passos.splice(i, 1); },
        limparPlanejamento() { if(confirm("Limpar rota?")) this.rotaEmPlanejamento.passos = []; },
        
        async salvarNoBanco() {
            if(confirm("Confirmar envio do planejamento de " + this.rotaEmPlanejamento.passos.length + " cidades para o MySQL?")) {
                alert("Simulação: Dados enviados com sucesso para as tabelas rotas_planejamento e rota_cidades_detalhes!");
            }
        },
        async gerarRelatorioPDF() {
            const { jsPDF } = window.jspdf; const doc = new jsPDF();
            doc.text("Roteiro de Viagem - Licitanet", 105, 20, { align: 'center' });
            let y = 40;
            this.rotaEmPlanejamento.passos.forEach((p, i) => {
                doc.text(`${i+1}. ${p.municipio} (${p.uf}) - KM: ${p.km_total}`, 20, y);
                y += 10;
                p.orgaosSelecionados.forEach(o => { doc.text(`  - ${o.nome_orgao}`, 25, y); y += 7; });
                y += 5;
            });
            doc.save("Rota.pdf");
        },
        gerarLinkPNCP(id) { return id ? `https://pncp.gov.br/app/editais/${id.split('-')[0]}/${id.split('/')[1]}/${parseInt(id.split('-').pop(), 10)}` : '#'; },
        abrirModalAlertas() { this.alertasExpandidos = true; },
        fecharModalAlertas() { this.alertasExpandidos = false; },
        mudarPagina(p) { this.paginaAtualRadar = p; }
    }
}).mount('#app');