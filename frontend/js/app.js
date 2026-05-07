const GEMINI_API_KEY = "SUA_CHAVE_AQUI"; // Substitua pela sua chave real

const { createApp, markRaw, nextTick } = Vue;

const CORES_SISTEMAS = {
    "Licitanet": "#FFD700", "Bll Compras": "#003a24", "Compras.Gov.Br": "#FF0000",
    "BBMNET": "#FF1493", "Br Conectado": "#800000", "Licitações-e (BB)": "#000080",
    "Bnc - Bolsa Nacional": "#87CEEB", "Compras Br": "#00CED1",
    "Licitar Digital": "#008000", "Licita Mais": "#32CD32", "Conlicitacao": "#2E8B57",
    "Portal de Compras Públicas": "#8A2BE2", "Start Gov": "#8B4513",
    "Sem Dados no PNCP": "#444444", "Outros": "#A9A9A9"  
};

createApp({
    data() {
        return {
            abaAtiva: 'mapa',
            dadosMercado: [], dadosHistorico: [], dadosIA: [], listaUFs: [], listaCidades: [],
            ufsSelecionadas: ['Todos'], cidadeSelecionada: 'Todos', buscaCidade: '',
            mapa: null, camadaGeoJson: null, camadaEstados: null, coresSistemas: CORES_SISTEMAS,
            
            // PLANEJADOR
            planejadorUF: '', planejadorBuscaCidade: '', promptGestor: '',
            carregandoIA: false, calculandoKM: false,
            rotaEmPlanejamento: { passos: [] },
            novaCidadeRota: {
                data_visita: '', municipio: '', uf: '', km_estrada: 0, km_cidade: 0,
                vr_hospedagem: 0, vr_jantar: 0, orgaosDisponiveis: [], orgaosSelecionados: []
            }
        }
    },
    computed: {
        rotaAgrupadaPorData() {
            const agrupado = {};
            const passosOrdenados = [...this.rotaEmPlanejamento.passos].sort((a,b) => new Date(a.data_visita) - new Date(b.data_visita));
            passosOrdenados.forEach(p => {
                if (!agrupado[p.data_visita]) agrupado[p.data_visita] = [];
                agrupado[p.data_visita].push(p);
            });
            return agrupado;
        },
        cidadesFiltradasNaBusca() {
            if (!this.buscaCidade) return this.listaCidades;
            return this.listaCidades.filter(c => c.toLowerCase().includes(this.buscaCidade.toLowerCase()));
        },
        cidadesFiltradasPlanejador() {
            if (!this.planejadorUF) return [];
            const cidades = [...new Set(this.dadosMercado.filter(d => d.uf === this.planejadorUF).map(d => d.cidade_norm))].sort();
            return this.planejadorBuscaCidade ? cidades.filter(c => c.toLowerCase().includes(this.planejadorBuscaCidade.toLowerCase())) : cidades;
        },
        textoEstadosSelecionados() {
            if (this.ufsSelecionadas.includes('Todos')) return 'Brasil';
            return this.ufsSelecionadas.join(', ');
        },
        calcularTotalKM() { return this.rotaEmPlanejamento.passos.reduce((acc, p) => acc + parseFloat(p.km_total || 0), 0); },
        calcularTotalCustos() { return this.rotaEmPlanejamento.passos.reduce((acc, p) => acc + parseFloat(p.vr_hospedagem || 0) + parseFloat(p.vr_jantar || 0), 0).toFixed(2); }
    },
    async mounted() {
        this.iniciarMapa();
        await this.carregarArquivos();
    },
    methods: {
        async mudarAba(aba) {
            this.abaAtiva = aba;
            await nextTick();
            if (aba === 'mapa' && this.mapa) this.mapa.invalidateSize();
        },
        iniciarMapa() {
            if (document.getElementById('map')) {
                this.mapa = markRaw(L.map('map').setView([-15.78, -47.92], 4));
                L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png').addTo(this.mapa);
            }
        },
        async carregarArquivos() {
            try {
                const [resDados, resHist, resIA, resEstados] = await Promise.all([
                    fetch('../data/output/dados_mercado.json'), fetch('../data/output/historico.json'),
                    fetch('../data/output/rotas_ia.json'), fetch('https://raw.githubusercontent.com/luizpedone/brazil-geojson/master/coords/states.json')
                ]);
                if (resDados.ok) this.dadosMercado = await resDados.json();
                if (resHist.ok) this.dadosHistorico = await resHist.json();
                if (resIA.ok) this.dadosIA = await resIA.json();
                if (resEstados.ok) { this.geoJsonEstados = markRaw(await resEstados.json()); this.renderizarEstados(); }
                this.listaUFs = [...new Set(this.dadosMercado.map(d => d.uf))].sort();
            } catch (e) { console.error(e); }
        },
        renderizarEstados() {
            if (this.camadaEstados) this.mapa.removeLayer(this.camadaEstados);
            this.camadaEstados = markRaw(L.geoJSON(this.geoJsonEstados, { style: { color: '#fff', weight: 1.2, fillOpacity: 0, interactive: false } })).addTo(this.mapa);
        },
        renderizarPoligonos() {
            if (!this.geoJsonDados || !this.mapa) return;
            // Remove a camada anterior para não sobrecarregar o mapa
            if (this.camadaGeoJson) this.mapa.removeLayer(this.camadaGeoJson);

            const mapDados = {};
            this.dadosFiltrados.forEach(d => { 
                if(d.cod_ibge) {
                    const id6 = String(d.cod_ibge).substring(0,6);
                    mapDados[id6] = d; 
                }
            });

            this.camadaGeoJson = markRaw(L.geoJSON(this.geoJsonDados, {
                style: (feature) => {
                    const rawId = feature.id || feature.properties.id || feature.properties.cod_ibge || feature.properties.GEOCODIGO;
                    const cod6 = String(rawId).substring(0,6);
                    const dadosCidade = mapDados[cod6];
                    
                    let cor = CORES_SISTEMAS["Sem Dados no PNCP"];
                    if (dadosCidade && CORES_SISTEMAS[dadosCidade.sistema_fonte]) {
                        cor = CORES_SISTEMAS[dadosCidade.sistema_fonte];
                    }
                    
                    return { 
                        fillColor: cor, 
                        weight: 0.5, 
                        color: '#111', 
                        opacity: 0.8, 
                        fillOpacity: 0.9 
                    };
                },
                onEachFeature: (feature, layer) => {
                    const rawId = feature.id || feature.properties.id || feature.properties.cod_ibge || feature.properties.GEOCODIGO;
                    const cod6 = String(rawId).substring(0,6);
                    const dadosCidade = mapDados[cod6];
                    
                    if (dadosCidade) {
                        layer.bindPopup(`
                            <div style="color: #222; font-family: sans-serif;">
                                <b style="font-size: 14px;">${dadosCidade.cidade_norm} - ${dadosCidade.uf}</b><br>
                                <span style="display:inline-block; margin-top:5px;">Plataforma: <b>${dadosCidade.sistema_fonte}</b></span><br>
                                <span>Status: <b style="color: ${dadosCidade.status_municipio === 'Exclusivo' ? '#2E8B57' : '#4682B4'}">${dadosCidade.status_municipio}</b></span>
                            </div>
                        `);
                    } else {
                        layer.bindPopup(`<div style="color: #222;"><b>${feature.properties.name || 'Município'}</b><br>Sem Dados no PNCP</div>`);
                    }
                }
            })).addTo(this.mapa);

            // Ajusta o zoom automaticamente com um respiro de 20px nas bordas
            if (!this.ufsSelecionadas.includes('Todos') && this.camadaGeoJson.getBounds().isValid()) {
                this.mapa.fitBounds(this.camadaGeoJson.getBounds(), { padding: [20, 20] });
            }

            // O SEGREDO DO VISUAL: Traz o contorno branco dos estados para a frente
            if (this.camadaEstados) {
                this.camadaEstados.bringToFront();
            }
        },
        tratarSelecaoUFs(uf) {
            if (uf === 'Todos') this.ufsSelecionadas = ['Todos'];
            else { const i = this.ufsSelecionadas.indexOf('Todos'); if (i > -1) this.ufsSelecionadas.splice(i, 1); }
            this.cidadeSelecionada = 'Todos';
            this.filtrarDados();
        },
        selecionarCidade(c) { this.cidadeSelecionada = c; this.filtrarDados(); },
        filtrarDados() {
            const filtrados = this.ufsSelecionadas.includes('Todos') ? this.dadosMercado : this.dadosMercado.filter(d => this.ufsSelecionadas.includes(d.uf));
            this.listaCidades = this.ufsSelecionadas.length === 1 ? [...new Set(filtrados.map(d => d.cidade_norm))].sort() : [];
        },
        formatarDataBR(data) {
            if (!data) return '';
            const [y, m, d] = data.split('-');
            return `${d}/${m}/${y}`;
        },
        limparSelecaoCidadePlanejador() { this.novaCidadeRota.municipio = ''; this.novaCidadeRota.orgaosDisponiveis = []; },
        selecionarCidadePlanejador(c) {
            this.novaCidadeRota.municipio = c; this.novaCidadeRota.uf = this.planejadorUF;
            const orgs = this.dadosHistorico.filter(d => d.municipio === c && d.uf === this.planejadorUF);
            const unicos = {};
            orgs.forEach(o => { if (!unicos[o.orgao]) unicos[o.orgao] = { nome_orgao: o.orgao, sistema_fonte: o.plataforma }; });
            this.novaCidadeRota.orgaosDisponiveis = Object.values(unicos);
        },
        adicionarCidadeARota() {
            this.rotaEmPlanejamento.passos.push({
                ...this.novaCidadeRota,
                id_temp: Date.now() + Math.random(),
                km_total: parseFloat(this.novaCidadeRota.km_estrada) + parseFloat(this.novaCidadeRota.km_cidade),
                orgaosSelecionados: [...this.novaCidadeRota.orgaosSelecionados]
            });
            const dataSalva = this.novaCidadeRota.data_visita;
            this.novaCidadeRota = { data_visita: dataSalva, municipio: '', uf: this.planejadorUF, km_estrada: 0, km_cidade: 0, vr_hospedagem: 0, vr_jantar: 0, orgaosDisponiveis: [], orgaosSelecionados: [] };
        },
        removerPasso(id) { this.rotaEmPlanejamento.passos = this.rotaEmPlanejamento.passos.filter(p => p.id_temp !== id); },
        limparPlanejamento() { if (confirm("Limpar?")) this.rotaEmPlanejamento.passos = []; },
        async salvarNoBanco() { alert("Simulação: Rota salva no MySQL!"); },
        
        async gerarRelatorioPDF() {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            doc.setFontSize(16); doc.text("Roteiro de Viagem Comercial - Licitanet", 105, 20, { align: 'center' });
            
            let y = 35;
            const agrupado = this.rotaAgrupadaPorData;

            Object.keys(agrupado).sort().forEach(data => {
                if (y > 260) { doc.addPage(); y = 20; }
                doc.setFont(undefined, 'bold');
                doc.setFillColor(240, 240, 240);
                doc.rect(20, y-5, 170, 7, 'F');
                doc.text(`DIA: ${this.formatarDataBR(data)}`, 22, y);
                y += 10;
                
                agrupado[data].forEach(p => {
                    doc.setFont(undefined, 'normal');
                    doc.text(`• ${p.municipio} (${p.uf}) - KM: ${p.km_total}`, 25, y);
                    y += 6;
                    p.orgaosSelecionados.forEach(o => {
                        doc.setFontSize(9); doc.text(`  - ${o.nome_orgao}`, 30, y); y += 4;
                    });
                    doc.setFontSize(10); y += 4;
                });
                y += 5;
            });
            
            doc.line(20, y, 190, y); y += 10;
            doc.setFont(undefined, 'bold');
            doc.text(`TOTAL KM: ${this.calcularTotalKM} km`, 20, y);
            doc.text(`CUSTO TOTAL: R$ ${this.calcularTotalCustos}`, 120, y);
            doc.save("Roteiro_Organizado.pdf");
        }
    }
}).mount('#app');