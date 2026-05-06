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
            dadosIA: [], // Dossiês da Inteligência Artificial
            dadosMercado: [], dadosFiltrados: [], alertas: [], alertasFiltrados: [], geoJsonDados: null,
            dadosHistorico: [], 
            mapa: null, camadaGeoJson: null, camadaEstados: null, geoJsonEstados: null, graficoPlat: null, graficoConc: null,
            ufsSelecionadas: ['Todos'], cidadeSelecionada: 'Todos', buscaCidade: '', 
            listaUFs: [], listaCidades: [], coresSistemas: CORES_SISTEMAS,
            dadosRadar: [], dadosRadarFiltrados: [], radarTipoOrgao: 'Todos', radarMeses: 2, radarPlataforma: 'Todas', listaPlataformasRadar: [],
            alertasExpandidos: false, paginaAtualRadar: 1, itensPorPagina: 50,
            
            // --- VARIÁVEIS DO PLANEJADOR DE ROTAS ---
            rotaEmPlanejamento: {
                passos: []
            },
            novaCidadeRota: {
                municipio: '',
                km_estrada: 0,
                km_cidade: 0,
                vr_hospedagem: 0,
                vr_jantar: 0,
                orgaosDisponiveis: [],
                orgaosSelecionados: []
            },
            listaCidadesFull: [] // Lista de todas as cidades disponíveis para seleção no planejador
        }
    },
    computed: {
        cidadesFiltradasNaBusca() {
            if (!this.buscaCidade) return this.listaCidades;
            const termo = this.buscaCidade.toLowerCase();
            return this.listaCidades.filter(c => c.toLowerCase().includes(termo));
        },
        textoEstadosSelecionados() {
            if (this.ufsSelecionadas.includes('Todos') || this.ufsSelecionadas.length === 0) return 'Todos';
            if (this.ufsSelecionadas.length <= 3) return this.ufsSelecionadas.join(', ');
            return `${this.ufsSelecionadas.length} estados selecionados`;
        },
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
        },
        radarPaginado() {
            const inicio = (this.paginaAtualRadar - 1) * this.itensPorPagina;
            const fim = inicio + this.itensPorPagina;
            return this.dadosRadarFiltrados.slice(inicio, fim);
        },
        totalPaginasRadar() {
            return Math.ceil(this.dadosRadarFiltrados.length / this.itensPorPagina) || 1;
        },
        historicoFiltrado() {
            if (this.cidadeSelecionada === 'Todos' || this.ufsSelecionadas.includes('Todos') || this.ufsSelecionadas.length > 1) {
                return {}; 
            }
            const dadosCidade = this.dadosHistorico.filter(h => h.uf === this.ufsSelecionadas[0] && h.municipio === this.cidadeSelecionada);
            const agrupado = {};
            dadosCidade.forEach(item => {
                if (!agrupado[item.orgao]) agrupado[item.orgao] = [];
                agrupado[item.orgao].push(item);
            });
            return agrupado;
        },
        
        // --- COMPUTED DO PLANEJADOR DE ROTAS ---
        calcularTotalKM() {
            return this.rotaEmPlanejamento.passos.reduce((acc, p) => acc + parseFloat(p.km_total || 0), 0);
        },
        calcularTotalCustos() {
            return this.rotaEmPlanejamento.passos.reduce((acc, p) => acc + parseFloat(p.vr_hospedagem || 0) + parseFloat(p.vr_jantar || 0), 0).toFixed(2);
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
                L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', { opacity: 0.9 }).addTo(this.mapa);
            }
        },
        
        async carregarArquivos() {
            try {
                const resRadar = await fetch('../data/output/radar.json');
                if (resRadar.ok) {
                    this.dadosRadar = await resRadar.json();
                    const plats = [...new Set(this.dadosRadar.map(item => item.Plataforma).filter(Boolean))];
                    this.listaPlataformasRadar = plats.sort();
                }

                // Busca todos os arquivos de dados em paralelo
                const [resAlertas, resDados, resGeo, resEstados, resHist, resIA] = await Promise.all([
                    fetch('../data/output/alertas.json'), 
                    fetch('../data/output/dados_mercado.json'), 
                    fetch('../data/geo/municipios_ibge.json/geojs-100-mun.json'),
                    fetch('https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/brazil-states.geojson'),
                    fetch('../data/output/historico.json'),
                    fetch('../data/output/rotas_ia.json')
                ]);
                
                if (resAlertas.ok) {
                    this.alertas = await resAlertas.json();
                    this.alertasFiltrados = this.alertas; 
                }
                
                if (resDados.ok) {
                    this.dadosMercado = await resDados.json();
                    // Alimenta a lista completa de cidades para o Planejador
                    this.listaCidadesFull = [...new Set(this.dadosMercado.map(d => d.cidade_norm))].sort();
                }
                
                if (resGeo.ok) this.geoJsonDados = markRaw(await resGeo.json());
                
                if (resEstados.ok) {
                    this.geoJsonEstados = markRaw(await resEstados.json());
                    this.renderizarEstados();
                }

                if (resHist && resHist.ok) this.dadosHistorico = await resHist.json();
                
                if (resIA && resIA.ok) this.dadosIA = await resIA.json();

                this.prepararFiltros();
                this.filtrarDados(); 
            } catch (erro) { console.error("Erro geral no carregamento:", erro); }
        },

        prepararFiltros() {
            const ufs = [...new Set(this.dadosMercado.map(item => item.uf).filter(Boolean))];
            this.listaUFs = ufs.sort();
        },

        tratarSelecaoUFs(clicado) {
            if (clicado === 'Todos') {
                this.ufsSelecionadas = this.ufsSelecionadas.includes('Todos') ? ['Todos'] : (this.ufsSelecionadas.length === 0 ? ['Todos'] : this.ufsSelecionadas);
            } else {
                const index = this.ufsSelecionadas.indexOf('Todos');
                if (index > -1) this.ufsSelecionadas.splice(index, 1);
                if (this.ufsSelecionadas.length === 0) this.ufsSelecionadas = ['Todos'];
            }
            if (this.ufsSelecionadas.includes('Todos') || this.ufsSelecionadas.length > 1) {
                this.cidadeSelecionada = 'Todos'; 
                this.buscaCidade = ''; 
            }
            this.filtrarDados();
        },

        selecionarCidade(cidade) {
            this.cidadeSelecionada = cidade;
            this.buscaCidade = ''; 
            this.filtrarDados();
        },

        filtrarDados() {
            if (this.ufsSelecionadas.includes('Todos')) {
                this.dadosFiltrados = [...this.dadosMercado];
                this.listaCidades = [];
                if(this.mapa) this.mapa.setView([-15.7801, -47.9292], 4); 
            } else {
                this.dadosFiltrados = this.dadosMercado.filter(item => this.ufsSelecionadas.includes(item.uf));
                const cidades = [...new Set(this.dadosFiltrados.map(item => item.cidade_norm).filter(Boolean))];
                this.listaCidades = cidades.sort();
                if (this.cidadeSelecionada !== 'Todos') {
                    this.dadosFiltrados = this.dadosFiltrados.filter(item => item.cidade_norm === this.cidadeSelecionada);
                }
            }
            this.alertasFiltrados = this.alertas.filter(alerta => {
                let bateUf = this.ufsSelecionadas.includes('Todos') || this.ufsSelecionadas.includes(alerta.uf);
                let bateCidade = (this.cidadeSelecionada === 'Todos') || (alerta.cidade_norm === this.cidadeSelecionada);
                return bateUf && bateCidade;
            });
            if (this.abaAtiva === 'mapa') this.renderizarPoligonos();
            if (this.abaAtiva === 'dashboards') this.atualizarDashboards();
            this.filtrarRadar(); 
        },

        filtrarRadar() {
            let filtrados = this.dadosRadar || [];
            if (!this.ufsSelecionadas.includes('Todos')) filtrados = filtrados.filter(d => this.ufsSelecionadas.includes(d.Estado));
            if (this.radarPlataforma !== 'Todas') filtrados = filtrados.filter(d => d.Plataforma === this.radarPlataforma);
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
            this.paginaAtualRadar = 1; 
        },

        renderizarEstados() {
            if (!this.geoJsonEstados || !this.mapa) return;
            this.camadaEstados = markRaw(L.geoJSON(this.geoJsonEstados, {
                style: { color: '#ffffff', weight: 1.5, fillOpacity: 0, interactive: false }
            })).addTo(this.mapa);
        },

        renderizarPoligonos() {
            if (!this.geoJsonDados || !this.mapa) return;
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
                    
                    return { fillColor: cor, weight: 0.5, color: '#111', opacity: 0.8, fillOpacity: 0.9 };
                },
                onEachFeature: (feature, layer) => {
                    const rawId = feature.id || feature.properties.id || feature.properties.cod_ibge || feature.properties.GEOCODIGO;
                    const cod6 = String(rawId).substring(0,6);
                    const dadosCidade = mapDados[cod6];
                    
                    if (dadosCidade) {
                        layer.bindPopup(`<div style="color: #222;"><b>${dadosCidade.cidade_norm} - ${dadosCidade.uf}</b><br>Plataforma: <b>${dadosCidade.sistema_fonte}</b><br>Status: ${dadosCidade.status_municipio}</div>`);
                    } else {
                        layer.bindPopup(`<div style="color: #222;"><b>${feature.properties.name || 'Município'}</b><br>Sem Dados no PNCP</div>`);
                    }
                }
            })).addTo(this.mapa);

            if (!this.ufsSelecionadas.includes('Todos') && this.camadaGeoJson.getBounds().isValid()) {
                this.mapa.fitBounds(this.camadaGeoJson.getBounds());
            }
            if (this.camadaEstados) this.camadaEstados.bringToFront();
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
            if (this.dadosRadarFiltrados.length === 0) return;
            const ws = XLSX.utils.json_to_sheet(this.dadosRadarFiltrados);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Alvos");
            XLSX.writeFile(wb, `Alvos_Comerciais.xlsx`);
        },
        
        baixarRelatorio() {
            if (this.dadosFiltrados.length === 0) return;
            const dadosExcel = this.dadosFiltrados.map(d => ({
                'UF': d.uf || '', 'Município': d.cidade_norm || '', 'Plataforma': d.sistema_fonte || 'Sem Dados no PNCP',
                'Status': d.status_municipio || 'Sem Registro'
            }));
            const ws = XLSX.utils.json_to_sheet(dadosExcel);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Relatório");
            XLSX.writeFile(wb, `Relatorio_Mercado.xlsx`);
        },

        gerarLinkPNCP(id_pncp) {
            if (!id_pncp) return '#';
            try {
                const partesBarra = id_pncp.split('/');
                if (partesBarra.length !== 2) return '#';
                const ano = partesBarra[1]; 
                const partesHifen = partesBarra[0].split('-');
                const cnpj = partesHifen[0]; 
                const numeroStr = partesHifen[partesHifen.length - 1]; 
                const numero = parseInt(numeroStr, 10); 
                return `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${numero}`;
            } catch (e) { return '#'; }
        },
        
        abrirModalAlertas() { this.alertasExpandidos = true; },
        fecharModalAlertas() { this.alertasExpandidos = false; },
        mudarPagina(p) { if (p >= 1 && p <= this.totalPaginasRadar) this.paginaAtualRadar = p; },

        // --- FUNÇÃO PARA FORMATAR O TEXTO DA INTELIGÊNCIA ARTIFICIAL ---
        formatarTextoIA(texto) {
            if (!texto) return '';
            let formatado = texto.replace(/\*\*(.*?)\*\*/g, '<strong class="text-warning">$1</strong>');
            formatado = formatado.replace(/\n?\s*\*\s/g, '<br><br>🎯 ');
            if (formatado.startsWith('<br><br>')) {
                formatado = formatado.substring(8);
            }
            return formatado;
        },

        // --- MÉTODOS DO PLANEJADOR DE ROTAS ---
        async carregarOrgaosParaRota() {
            if (!this.novaCidadeRota.municipio) return;
            // Busca no dadosMercado os órgãos daquela cidade
            this.novaCidadeRota.orgaosDisponiveis = this.dadosMercado.filter(d => 
                d.cidade_norm === this.novaCidadeRota.municipio
            );
            this.novaCidadeRota.orgaosSelecionados = [];
        },
        
        adicionarCidadeARota() {
            const p = this.novaCidadeRota;
            this.rotaEmPlanejamento.passos.push({
                municipio: p.municipio,
                km_estrada: p.km_estrada,
                km_cidade: p.km_cidade,
                km_total: parseFloat(p.km_estrada) + parseFloat(p.km_cidade),
                vr_hospedagem: p.vr_hospedagem,
                vr_jantar: p.vr_jantar,
                orgaosSelecionados: [...p.orgaosSelecionados]
            });
            // Limpa o formulário para a próxima cidade
            this.novaCidadeRota = { municipio: '', km_estrada: 0, km_cidade: 0, vr_hospedagem: 0, vr_jantar: 0, orgaosDisponiveis: [], orgaosSelecionados: [] };
        },
        
        removerPasso(index) {
            this.rotaEmPlanejamento.passos.splice(index, 1);
        },
        
        limparPlanejamento() {
            if(confirm("Deseja realmente limpar toda a rota?")) {
                this.rotaEmPlanejamento.passos = [];
            }
        },
        
        async gerarRelatorioPDF() {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            
            // Título
            doc.setFontSize(18);
            doc.text("Relatório de Planejamento de Viagem - Licitanet", 105, 20, { align: 'center' });
            
            doc.setFontSize(10);
            doc.text(`Gerado em: ${new Date().toLocaleString()}`, 105, 28, { align: 'center' });
            
            let y = 40;
            
            this.rotaEmPlanejamento.passos.forEach((p, i) => {
                if (y > 250) { doc.addPage(); y = 20; }
                
                doc.setFont(undefined, 'bold');
                doc.text(`${i+1}. Cidade: ${p.municipio}`, 20, y);
                y += 7;
                
                doc.setFont(undefined, 'normal');
                doc.text(`KM Estrada: ${p.km_estrada} | KM Cidade: ${p.km_cidade} | Total: ${p.km_total} km`, 25, y);
                y += 5;
                doc.text(`Custos: Hospedagem R$ ${p.vr_hospedagem} | Jantar R$ ${p.vr_jantar}`, 25, y);
                y += 7;
                
                doc.text("Órgãos a visitar:", 25, y);
                y += 5;
                p.orgaosSelecionados.forEach(o => {
                    doc.text(`- ${o.nome_orgao} (Portal: ${o.sistema_fonte})`, 30, y);
                    y += 5;
                });
                y += 10;
            });
            
            doc.save(`Rota_Licitanet_${new Date().getTime()}.pdf`);
        }
    }
}).mount('#app');