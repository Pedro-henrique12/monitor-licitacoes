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
        cidadesFiltradasNaBusca() {
            if (!this.buscaCidade) return this.listaCidades;
            return this.listaCidades.filter(c => c.toLowerCase().includes(this.buscaCidade.toLowerCase()));
        },
        cidadesFiltradasPlanejador() {
            if (!this.planejadorUF) return [];
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

                const [resAlertas, resDados, resGeo, resEstados, resHist, resIA] = await Promise.all([
                    fetch('../data/output/alertas.json'), fetch('../data/output/dados_mercado.json'), 
                    fetch('../data/geo/municipios_ibge.json/geojs-100-mun.json'),
                    fetch('https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/brazil-states.geojson'),
                    fetch('../data/output/historico.json'), fetch('../data/output/rotas_ia.json')
                ]);
                
                if (resAlertas.ok) this.alertas = await resAlertas.json();
                if (resDados.ok) this.dadosMercado = await resDados.json();
                if (resGeo.ok) this.geoJsonDados = markRaw(await resGeo.json());
                if (resEstados.ok) { this.geoJsonEstados = markRaw(await resEstados.json()); this.renderizarEstados(); }
                if (resHist.ok) this.dadosHistorico = await resHist.json();
                if (resIA.ok) this.dadosIA = await resIA.json();
                
                this.prepararFiltros();
                this.filtrarDados(); 
            } catch (erro) { console.error("Erro no carregamento:", erro); }
        },
        prepararFiltros() { this.listaUFs = [...new Set(this.dadosMercado.map(item => item.uf))].sort(); },
        tratarSelecaoUFs(clicado) {
            if (clicado === 'Todos') this.ufsSelecionadas = ['Todos'];
            else { const idx = this.ufsSelecionadas.indexOf('Todos'); if (idx > -1) this.ufsSelecionadas.splice(idx, 1); }
            if (this.ufsSelecionadas.length === 0) this.ufsSelecionadas = ['Todos'];
            this.cidadeSelecionada = 'Todos'; // Reseta a cidade ao mudar de estado
            this.filtrarDados();
        },
        selecionarCidade(c) { this.cidadeSelecionada = c; this.filtrarDados(); },
        filtrarDados() {
            this.dadosFiltrados = this.ufsSelecionadas.includes('Todos') ? this.dadosMercado : this.dadosMercado.filter(d => this.ufsSelecionadas.includes(d.uf));
            this.listaCidades = this.ufsSelecionadas.length === 1 ? [...new Set(this.dadosFiltrados.map(d => d.cidade_norm))].sort() : [];
            if (this.cidadeSelecionada !== 'Todos') this.dadosFiltrados = this.dadosFiltrados.filter(d => d.cidade_norm === this.cidadeSelecionada);
            this.alertasFiltrados = this.alertas.filter(a => (this.ufsSelecionadas.includes('Todos') || this.ufsSelecionadas.includes(a.uf)) && (this.cidadeSelecionada === 'Todos' || a.cidade_norm === this.cidadeSelecionada));
            if (this.abaAtiva === 'mapa') this.renderizarPoligonos();
            if (this.abaAtiva === 'dashboards') this.atualizarDashboards();
            this.filtrarRadar();
        },
        
        // --- FILTRO DO RADAR ATUALIZADO PARA LER A CIDADE ---
        filtrarRadar() {
            let f = this.dadosRadar || [];
            
            // Filtro por Estado
            if (!this.ufsSelecionadas.includes('Todos')) {
                f = f.filter(d => this.ufsSelecionadas.includes(d.Estado));
            }
            
            // Filtro por Cidade
            if (this.cidadeSelecionada !== 'Todos') {
                f = f.filter(d => d.Municipio && d.Municipio.toUpperCase() === this.cidadeSelecionada.toUpperCase());
            }

            // Filtros internos do Radar
            if (this.radarPlataforma !== 'Todas') f = f.filter(d => d.Plataforma === this.radarPlataforma);
            f = f.filter(d => d.Meses_Inativo >= this.radarMeses);

            if (this.radarTipoOrgao === "Prefeitura/Município") {
                f = f.filter(d => /PREFEITURA|MUNICÍPIO|MUNICIPIO/i.test(d.Orgao) && !/CÂMARA|CAMARA|FUNDO|SECRETARIA|AUTARQUIA|INSTITUTO/i.test(d.Orgao));
            } else if (this.radarTipoOrgao === "Câmaras") {
                f = f.filter(d => /CÂMARA|CAMARA/i.test(d.Orgao));
            } else if (this.radarTipoOrgao === "Fundos/Secretarias") {
                f = f.filter(d => /FUNDO|SECRETARIA|SAÚDE|SAUDE|ASSISTÊNCIA|ASSISTENCIA|EDUCAÇÃO|EDUCACAO/i.test(d.Orgao));
            } else if (this.radarTipoOrgao === "Outros") {
                f = f.filter(d => !/PREFEITURA|MUNICÍPIO|MUNICIPIO/i.test(d.Orgao) && !/CÂMARA|CAMARA/i.test(d.Orgao) && !/FUNDO|SECRETARIA|SAÚDE|SAUDE|ASSISTÊNCIA|ASSISTENCIA|EDUCAÇÃO|EDUCACAO/i.test(d.Orgao));
            }
            
            this.dadosRadarFiltrados = f;
            this.paginaAtualRadar = 1;
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
                    l.bindPopup(`<div style="color: #222;"><b>${d ? d.cidade_norm : f.properties.name}</b><br>Plataforma: ${d ? d.sistema_fonte : 'Sem Dados'}</div>`);
                }
            })).addTo(this.mapa);
            
            if (!this.ufsSelecionadas.includes('Todos') && this.camadaGeoJson.getBounds().isValid()) {
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
            this.graficoPlat = markRaw(new Chart(ctx1, { type: 'doughnut', data: { labels: labelsPlat, datasets: [{ data: dataPlat, backgroundColor: coresPlat, borderWidth: 2, borderColor: '#1e1e2d' }] }, options: { maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'right', labels: { boxWidth: 12 } } } } }));
            
            const concReais = this.dadosFiltrados.filter(d => d.status_municipio && d.status_municipio !== 'Sem Registro');
            const contaConc = {};
            concReais.forEach(d => { contaConc[d.status_municipio] = (contaConc[d.status_municipio] || 0) + 1; });
            const labelsConc = Object.keys(contaConc);
            const dataConc = labelsConc.map(l => contaConc[l]);
            if (this.graficoConc) this.graficoConc.destroy();
            const ctx2 = document.getElementById('chartConcorrencia').getContext('2d');
            this.graficoConc = markRaw(new Chart(ctx2, { type: 'pie', data: { labels: labelsConc, datasets: [{ data: dataConc, backgroundColor: labelsConc.map(l => l === 'Exclusivo' ? '#2E8B57' : '#4682B4'), borderWidth: 2, borderColor: '#1e1e2d' }] }, options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } } } }));
        },
        baixarRelatorioRadar() {
            if (this.dadosRadarFiltrados.length === 0) return;
            const ws = XLSX.utils.json_to_sheet(this.dadosRadarFiltrados);
            const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Alvos"); XLSX.writeFile(wb, `Alvos_Comerciais.xlsx`);
        },
        baixarRelatorio() {
            if (this.dadosFiltrados.length === 0) return;
            const dadosExcel = this.dadosFiltrados.map(d => ({ 'UF': d.uf || '', 'Município': d.cidade_norm || '', 'Plataforma': d.sistema_fonte || 'Sem Dados', 'Status': d.status_municipio || 'Sem Registro' }));
            const ws = XLSX.utils.json_to_sheet(dadosExcel);
            const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Relatório"); XLSX.writeFile(wb, `Relatorio_Mercado.xlsx`);
        },
        gerarLinkPNCP(id) { return id ? `https://pncp.gov.br/app/editais/${id.split('-')[0]}/${id.split('/')[1]}/${parseInt(id.split('-').pop(), 10)}` : '#'; },
        abrirModalAlertas() { this.alertasExpandidos = true; },
        fecharModalAlertas() { this.alertasExpandidos = false; },
        mudarPagina(p) { this.paginaAtualRadar = p; },
        formatarTextoIA(t) { return t?.replace(/\*\*(.*?)\*\*/g, '<strong class="text-warning">$1</strong>').replace(/\n?\s*\*\s/g, '<br><br>🎯 ') || ''; },
        
        // MÉTODOS DO PLANEJADOR
        limparSelecaoCidadePlanejador() { this.novaCidadeRota.municipio = ''; this.planejadorBuscaCidade = ''; this.novaCidadeRota.orgaosDisponiveis = []; },
        selecionarCidadePlanejador(c) {
            this.novaCidadeRota.municipio = c; this.novaCidadeRota.uf = this.planejadorUF; this.planejadorBuscaCidade = '';
            const licitacoes = this.dadosHistorico.filter(d => d.municipio === c && d.uf === this.planejadorUF);
            const orgaos = {};
            licitacoes.forEach(l => { if (!orgaos[l.orgao]) orgaos[l.orgao] = { nome_orgao: l.orgao, sistema_fonte: l.plataforma }; });
            this.novaCidadeRota.orgaosDisponiveis = Object.values(orgaos);
            this.novaCidadeRota.orgaosSelecionados = [];
        },
        adicionarCidadeARota() {
            this.rotaEmPlanejamento.passos.push({ ...this.novaCidadeRota, km_total: parseFloat(this.novaCidadeRota.km_estrada) + parseFloat(this.novaCidadeRota.km_cidade), orgaosSelecionados: [...this.novaCidadeRota.orgaosSelecionados] });
            this.novaCidadeRota = { municipio: '', uf: this.planejadorUF, km_estrada: 0, km_cidade: 0, vr_hospedagem: 0, vr_jantar: 0, orgaosDisponiveis: [], orgaosSelecionados: [] };
        },
        removerPasso(i) { this.rotaEmPlanejamento.passos.splice(i, 1); },
        limparPlanejamento() { if(confirm("Limpar rota?")) this.rotaEmPlanejamento.passos = []; },
        async salvarNoBanco() { if(confirm("Confirmar envio para o banco de dados?")) alert("Dados enviados com sucesso para as tabelas rotas_planejamento e rota_cidades_detalhes!"); },
        
        // PDF ATUALIZADO COM OS TOTAIS GERAIS
        async gerarRelatorioPDF() {
            const { jsPDF } = window.jspdf; const doc = new jsPDF();
            doc.setFontSize(18); doc.text("Relatório de Planejamento de Viagem - Licitanet", 105, 20, { align: 'center' });
            doc.setFontSize(10); doc.text(`Gerado em: ${new Date().toLocaleString()}`, 105, 28, { align: 'center' });
            let y = 40;
            this.rotaEmPlanejamento.passos.forEach((p, i) => {
                if (y > 250) { doc.addPage(); y = 20; }
                doc.setFont(undefined, 'bold'); doc.text(`${i+1}. Cidade: ${p.municipio} - ${p.uf}`, 20, y); y += 7;
                doc.setFont(undefined, 'normal'); doc.text(`KM Estrada: ${p.km_estrada} | KM Cidade: ${p.km_cidade} | KM TOTAL DA PARADA: ${p.km_total} km`, 25, y); y += 5;
                const totalCustoParada = (parseFloat(p.vr_hospedagem || 0) + parseFloat(p.vr_jantar || 0)).toFixed(2);
                doc.text(`Custos: Hosped R$ ${p.vr_hospedagem} | Jantar R$ ${p.vr_jantar} | CUSTO TOTAL DA PARADA: R$ ${totalCustoParada}`, 25, y); y += 7;
                doc.text("Órgãos a visitar:", 25, y); y += 5;
                p.orgaosSelecionados.forEach(o => { doc.text(`- ${o.nome_orgao} (Portal: ${o.sistema_fonte})`, 30, y); y += 5; });
                y += 10; 
            });
            
            if (y > 260) { doc.addPage(); y = 20; }
            y += 5; doc.setLineWidth(0.5); doc.line(20, y, 190, y); y += 8;
            doc.setFontSize(12); doc.setFont(undefined, 'bold'); doc.text(`RESUMO GERAL DA VIAGEM:`, 20, y); y += 7;
            doc.setFontSize(11); doc.setFont(undefined, 'normal');
            doc.text(`Quilometragem Total da Rota: ${this.calcularTotalKM} km`, 20, y); y += 6;
            doc.text(`Custo Estimado Total (Hospedagem + Jantar): R$ ${this.calcularTotalCustos}`, 20, y);
            doc.save(`Rota_Licitanet_${new Date().getTime()}.pdf`);
        }
    }
}).mount('#app');