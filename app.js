const { createApp, markRaw, nextTick } = Vue;

// 🎨 DICIONÁRIO DE CORES ATUALIZADO COM A SUA PALETA
const CORES_SISTEMAS = {
    "Licitanet": "#FFD700", "Bll Compras": "#FF8C00", "Compras.Gov.Br": "#FF0000",
    "BBMNET": "#FF1493", "Br Conectado": "#800000", "Licitações-e (BB)": "#000080",
    "Pncp": "#4169E1", "Bnc - Bolsa Nacional": "#87CEEB", "Compras Br": "#00CED1",
    "Licitar Digital": "#008000", "Licita Mais": "#32CD32", "Conlicitacao": "#2E8B57",
    "Portal de Compras Públicas": "#8A2BE2", "Start Gov": "#8B4513",
    "Sem Dados no PNCP": "#444444", 
    "Outros": "#A9A9A9"    // Padrão para plataformas não mapeadas 
};

// Define globalmente a cor do texto dos gráficos para Modo Escuro
Chart.defaults.color = '#a0aabf';

createApp({
    data() {
        return {
            abaAtiva: 'mapa', 
            dadosMercado: [], dadosFiltrados: [], alertas: [], alertasFiltrados: [], geoJsonDados: null,
            mapa: null, camadaGeoJson: null, graficoPlat: null, graficoConc: null,
            ufSelecionada: 'Todos', cidadeSelecionada: 'Todos', listaUFs: [], listaCidades: [], coresSistemas: CORES_SISTEMAS,
            dadosRadar: [], dadosRadarFiltrados: [], radarTipoOrgao: 'Todos', radarMeses: 2
        }
    },
    computed: {
        plataformaLider() {
            if(this.dadosFiltrados.length === 0) return '-';
            const contagem = {};
            this.dadosFiltrados.forEach(d => {
                if(d.sistema_fonte && d.sistema_fonte !== 'Sem Dados no PNCP') contagem[d.sistema_fonte] = (contagem[d.sistema_fonte] || 0) + 1;
            });
            const labels = Object.keys(contagem).sort((a,b) => contagem[b] - contagem[a]);
            return labels.length > 0 ? labels[0] : '-';
        },
        percentualExclusivo() {
            if(this.dadosFiltrados.length === 0) return '0';
            const total = this.dadosFiltrados.filter(d => d.status_municipio && d.status_municipio !== 'Sem Registro').length;
            if(total === 0) return '0';
            const exclusivos = this.dadosFiltrados.filter(d => d.status_municipio === 'Exclusivo').length;
            return ((exclusivos / total) * 100).toFixed(1);
        }
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
            if (novaAba === 'radar') this.filtrarRadar();
        },

        iniciarMapa() {
            if (document.getElementById('map') && !this.mapa) {
                this.mapa = markRaw(L.map('map', { preferCanvas: true }).setView([-15.7801, -47.9292], 4));
                // MAPA BASE DARK MATTER
                L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', { opacity: 0.9 }).addTo(this.mapa);
            }
        },
        
        async carregarArquivos() {
            try {
                try {
                    const resRadar = await fetch('radar.json');
                    if (resRadar.ok) this.dadosRadar = await resRadar.json();
                } catch (e) { console.log("Radar pendente."); }

                const [resAlertas, resDados, resGeo] = await Promise.all([
                    fetch('alertas.json'), fetch('dados_mercado.json'), fetch('municipios_ibge.json/geojs-100-mun.json')
                ]);
                
                if (resAlertas.ok) {
                    this.alertas = await resAlertas.json();
                    this.alertasFiltrados = this.alertas; // 🎯 INICIA OS ALERTAS FILTRADOS AQUI
                }
                if (resDados.ok) this.dadosMercado = await resDados.json();
                if (resGeo.ok) this.geoJsonDados = markRaw(await resGeo.json());

                this.prepararFiltros();
                this.filtrarDados(); 
                this.filtrarRadar();
            } catch (erro) { console.error("Erro:", erro); }
        },

        prepararFiltros() {
            const ufs = [...new Set(this.dadosMercado.map(item => item.uf).filter(Boolean))];
            this.listaUFs = ufs.sort();
        },

        filtrarDados() {
            // 1. Filtra os polígonos e os dashboards
            if (this.ufSelecionada === 'Todos') {
                this.dadosFiltrados = [...this.dadosMercado];
                this.listaCidades = [];
                this.cidadeSelecionada = 'Todos';
                if(this.mapa) this.mapa.setView([-15.7801, -47.9292], 4); 
            } else {
                this.dadosFiltrados = this.dadosMercado.filter(item => item.uf === this.ufSelecionada);
                const cidades = [...new Set(this.dadosFiltrados.map(item => item.cidade_norm).filter(Boolean))];
                this.listaCidades = cidades.sort();
                if (this.cidadeSelecionada !== 'Todos') this.dadosFiltrados = this.dadosFiltrados.filter(item => item.cidade_norm === this.cidadeSelecionada);
            }

            // 🎯 2. FILTRA OS ALERTAS DO TOPO DA TELA
            this.alertasFiltrados = this.alertas.filter(alerta => {
                let bateUf = (this.ufSelecionada === 'Todos') || (alerta.uf === this.ufSelecionada);
                let bateCidade = (this.cidadeSelecionada === 'Todos') || (alerta.cidade_norm === this.cidadeSelecionada);
                return bateUf && bateCidade;
            });

            if (this.abaAtiva === 'mapa') this.renderizarPoligonos();
            if (this.abaAtiva === 'dashboards') this.atualizarDashboards();
            this.filtrarRadar(); 
        },

        filtrarRadar() {
            let filtrados = this.dadosRadar || [];
            if (this.ufSelecionada !== 'Todos') filtrados = filtrados.filter(d => d.Estado === this.ufSelecionada);
            filtrados = filtrados.filter(d => d.Meses_Inativo >= this.radarMeses);

            if (this.radarTipoOrgao === "Prefeitura/Município") {
                filtrados = filtrados.filter(d => /PREFEITURA|MUNICÍPIO|MUNICIPIO/i.test(d.Orgao) && !/CÂMARA|CAMARA|FUNDO|SECRETARIA|AUTARQUIA|INSTITUTO/i.test(d.Orgao));
            } else if (this.radarTipoOrgao === "Câmaras") {
                filtrados = filtrados.filter(d => /CÂMARA|CAMARA/i.test(d.Orgao));
            } else if (this.radarTipoOrgao === "Fundos/Secretarias") {
                filtrados = filtrados.filter(d => /FUNDO|SECRETARIA|SAÚDE|SAUDE|ASSISTÊNCIA|ASSISTENCIA|EDUCAÇÃO|EDUCACAO/i.test(d.Orgao));
            } else if (this.radarTipoOrgao === "Outros") {
                filtrados = filtrados.filter(d => !/PREFEITURA|MUNICÍPIO|MUNICIPIO/i.test(d.Orgao) && !/CÂMARA|CAMARA/i.test(d.Orgao) && !/FUNDO|SECRETARIA|SAÚDE|SAUDE|ASSISTÊNCIA|ASSISTENCIA|EDUCAÇÃO|EDUCACAO/i.test(d.Orgao));
            }
            this.dadosRadarFiltrados = filtrados;
        },

        renderizarPoligonos() {
            if (!this.geoJsonDados || !this.mapa) return;
            if (this.camadaGeoJson) this.mapa.removeLayer(this.camadaGeoJson);

            const mapDados = {};
            this.dadosFiltrados.forEach(d => { if(d.cod_ibge) mapDados[d.cod_ibge.substring(0,6)] = d; });

            const estiloPoligono = (feature) => {
                const codIbgeFeature = String(feature.properties.id || feature.id).substring(0,6);
                const dadosCidade = mapDados[codIbgeFeature];
                let cor = CORES_SISTEMAS["Sem Dados no PNCP"];
                if (dadosCidade && CORES_SISTEMAS[dadosCidade.sistema_fonte]) cor = CORES_SISTEMAS[dadosCidade.sistema_fonte];
                
                // Bordas ligeiramente mais escuras para o dark mode
                return { fillColor: cor, weight: 0.5, color: '#111', opacity: 0.8, fillOpacity: 0.9 };
            };

            this.camadaGeoJson = markRaw(L.geoJSON(this.geoJsonDados, {
                style: estiloPoligono,
                onEachFeature: (feature, layer) => {
                    const codIbgeFeature = String(feature.properties.id || feature.id).substring(0,6);
                    const dadosCidade = mapDados[codIbgeFeature];
                    if (dadosCidade) {
                        layer.bindPopup(`<div style="color: #222;"><h6 style="margin-bottom: 2px;"><b>${dadosCidade.cidade_norm} - ${dadosCidade.uf}</b></h6>Plataforma: <b>${dadosCidade.sistema_fonte}</b><br>Status: ${dadosCidade.status_municipio}</div>`);
                    } else {
                        layer.bindPopup(`<div style="color: #222;"><b>${feature.properties.name || 'Cidade'}</b><br>Sem Dados no PNCP</div>`);
                    }
                }
            })).addTo(this.mapa);

            if (this.ufSelecionada !== 'Todos' && this.camadaGeoJson.getBounds().isValid()) {
                this.mapa.fitBounds(this.camadaGeoJson.getBounds());
            }
        },

        atualizarDashboards() {
            if (!document.getElementById('chartPlataformas')) return;

            const platReais = this.dadosFiltrados.filter(d => d.sistema_fonte && d.sistema_fonte !== 'Sem Dados no PNCP');
            const contaPlat = {};
            platReais.forEach(d => { contaPlat[d.sistema_fonte] = (contaPlat[d.sistema_fonte] || 0) + 1; });
            
            const labelsPlat = Object.keys(contaPlat).sort((a,b) => contaPlat[b] - contaPlat[a]).slice(0, 10);
            const dataPlat = labelsPlat.map(l => contaPlat[l]);
            const coresPlat = labelsPlat.map(l => this.coresSistemas[l] || this.coresSistemas['Outros']);

            if (this.graficoPlat) this.graficoPlat.destroy(); 
            
            const ctx1 = document.getElementById('chartPlataformas').getContext('2d');
            this.graficoPlat = markRaw(new Chart(ctx1, {
                type: 'doughnut', 
                // BorderColor combinando com o fundo do painel escuro
                data: { labels: labelsPlat, datasets: [{ data: dataPlat, backgroundColor: coresPlat, borderWidth: 2, borderColor: '#1e1e2d' }] },
                options: { maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'right', labels: { boxWidth: 12 } } } }
            }));

            const concReais = this.dadosFiltrados.filter(d => d.status_municipio && d.status_municipio !== 'Sem Registro');
            const contaConc = {};
            concReais.forEach(d => { contaConc[d.status_municipio] = (contaConc[d.status_municipio] || 0) + 1; });

            const labelsConc = Object.keys(contaConc);
            const dataConc = labelsConc.map(l => contaConc[l]);
            const coresStatus = { 'Exclusivo': '#2E8B57', 'Compartilhado': '#4682B4' };
            const coresConc = labelsConc.map(l => coresStatus[l] || '#A9A9A9');

            if (this.graficoConc) this.graficoConc.destroy();
            
            const ctx2 = document.getElementById('chartConcorrencia').getContext('2d');
            this.graficoConc = markRaw(new Chart(ctx2, {
                type: 'pie', 
                data: { labels: labelsConc, datasets: [{ data: dataConc, backgroundColor: coresConc, borderWidth: 2, borderColor: '#1e1e2d' }] },
                options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } }
            }));
        },

        baixarRelatorioRadar() {
            if (this.dadosRadarFiltrados.length === 0) { alert("Não há alvos para exportar."); return; }
            const ws = XLSX.utils.json_to_sheet(this.dadosRadarFiltrados);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Alvos");
            XLSX.writeFile(wb, `Alvos_Comerciais_${this.ufSelecionada}.xlsx`);
        },
        
        baixarRelatorio() {
            if (this.dadosFiltrados.length === 0) { alert("Não há dados na tela para exportar."); return; }
            const dadosExcel = this.dadosFiltrados.map(d => ({
                'UF': d.uf || '', 'Município': d.cidade_norm || '', 'Plataforma': d.sistema_fonte || 'Sem Dados no PNCP',
                'Status': d.status_municipio || 'Sem Registro', 'Detalhamento': d.resumo_disputa || 'Nenhuma licitação encontrada no PNCP.'
            }));
            const ws = XLSX.utils.json_to_sheet(dadosExcel);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Relatório");
            let nomeFiltro = this.ufSelecionada !== 'Todos' ? `_${this.ufSelecionada}` : '_Brasil';
            if (this.cidadeSelecionada !== 'Todos') nomeFiltro += `_${this.cidadeSelecionada}`;
            XLSX.writeFile(wb, `Relatorio_Mercado${nomeFiltro}.xlsx`);
        }
    }
}).mount('#app');