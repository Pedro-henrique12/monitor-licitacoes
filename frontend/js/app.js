// ATENÇÃO: Substitua pela sua chave da API do Gemini
const GEMINI_API_KEY = "SUA_CHAVE_AQUI";

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
            promptGestor: '',
            carregandoIA: false,
            calculandoKM: false,
            rotaEmPlanejamento: { passos: [] },
            novaCidadeRota: {
                data_visita: '', municipio: '', uf: '', km_estrada: 0, km_cidade: 0,
                vr_hospedagem: 0, vr_jantar: 0, orgaosDisponiveis: [], orgaosSelecionados: []
            }
        }
    },
    computed: {
        // --- Agrupamento por Data (Planejador) ---
        rotaAgrupadaPorData() {
            const agrupado = {};
            // Clona o array e ordena por data antes de agrupar
            const passosOrdenados = [...this.rotaEmPlanejamento.passos].sort((a,b) => new Date(a.data_visita) - new Date(b.data_visita));
            
            passosOrdenados.forEach(p => {
                const data = p.data_visita || 'Sem Data';
                if (!agrupado[data]) agrupado[data] = [];
                agrupado[data].push(p);
            });
            return agrupado;
        },
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
                    fetch('../data/output/alertas.json'), 
                    fetch('../data/output/dados_mercado.json'), 
                    fetch('../data/geo/municipios_ibge.json/geojs-100-mun.json'),
                    // VOLTAMOS PARA O SEU LINK ORIGINAL:
                    fetch('https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/brazil-states.geojson'),
                    fetch('../data/output/historico.json'), 
                    fetch('../data/output/rotas_ia.json')
                ]);
                
                if (resAlertas.ok) this.alertas = await resAlertas.json();
                if (resDados.ok) this.dadosMercado = await resDados.json();
                if (resGeo.ok) this.geoJsonDados = markRaw(await resGeo.json());
                if (resEstados.ok) { this.geoJsonEstados = markRaw(await resEstados.json()); this.renderizarEstados(); }
                if (resHist.ok) this.dadosHistorico = await resHist.json();
                if (resIA.ok) this.dadosIA = await resIA.json();
                
                this.prepararFiltros();
                this.filtrarDados(); 
            } catch (erro) { 
                console.error("Erro no carregamento dos arquivos:", erro); 
            }
        },
        prepararFiltros() { this.listaUFs = [...new Set(this.dadosMercado.map(item => item.uf))].sort(); },
        tratarSelecaoUFs(clicado) {
            if (clicado === 'Todos') this.ufsSelecionadas = ['Todos'];
            else { const idx = this.ufsSelecionadas.indexOf('Todos'); if (idx > -1) this.ufsSelecionadas.splice(idx, 1); }
            if (this.ufsSelecionadas.length === 0) this.ufsSelecionadas = ['Todos'];
            this.cidadeSelecionada = 'Todos'; 
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
        
        filtrarRadar() {
            let f = this.dadosRadar || [];
            if (!this.ufsSelecionadas.includes('Todos')) f = f.filter(d => this.ufsSelecionadas.includes(d.Estado));
            if (this.cidadeSelecionada !== 'Todos') f = f.filter(d => d.Municipio && d.Municipio.toUpperCase() === this.cidadeSelecionada.toUpperCase());
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
            if (!this.geoJsonEstados || !this.mapa) return;

            // Se já existir, remove antes de adicionar de novo
            if (this.camadaEstados) this.mapa.removeLayer(this.camadaEstados);
            
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
        
        // --- FUNÇÕES DO PLANEJADOR DE VIAGEM ---
        formatarDataBR(data) {
            if (!data || data === 'Sem Data') return data;
            const partes = data.split('-');
            if (partes.length !== 3) return data;
            return `${partes[2]}/${partes[1]}/${partes[0]}`;
        },
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
            this.rotaEmPlanejamento.passos.push({ 
                ...this.novaCidadeRota, 
                id_temp: Date.now() + Math.random(), // Adiciona um ID único para remoção
                km_total: parseFloat(this.novaCidadeRota.km_estrada) + parseFloat(this.novaCidadeRota.km_cidade), 
                orgaosSelecionados: [...this.novaCidadeRota.orgaosSelecionados] 
            });
            // Mantém a data e a UF selecionada para facilitar o cadastro de cidades vizinhas no mesmo dia
            const dataSalva = this.novaCidadeRota.data_visita;
            this.novaCidadeRota = { data_visita: dataSalva, municipio: '', uf: this.planejadorUF, km_estrada: 0, km_cidade: 0, vr_hospedagem: 0, vr_jantar: 0, orgaosDisponiveis: [], orgaosSelecionados: [] };
        },
        removerPasso(id) { 
            this.rotaEmPlanejamento.passos = this.rotaEmPlanejamento.passos.filter(p => p.id_temp !== id); 
        },
        limparPlanejamento() { if(confirm("Deseja limpar todo o roteiro?")) this.rotaEmPlanejamento.passos = []; },
        async salvarNoBanco() { if(confirm("Confirmar envio para o banco de dados?")) alert("Simulação: Rota salva com sucesso no MySQL!"); },
        
        async gerarRelatorioPDF() {
            const { jsPDF } = window.jspdf; 
            const doc = new jsPDF();
            doc.setFontSize(16); doc.text("Roteiro de Viagem Comercial - Licitanet", 105, 20, { align: 'center' });
            doc.setFontSize(10); doc.text(`Gerado em: ${new Date().toLocaleString()}`, 105, 26, { align: 'center' });
            
            let y = 35;
            const agrupado = this.rotaAgrupadaPorData;

            // Ordena as chaves de data cronologicamente
            const datasOrdenadas = Object.keys(agrupado).sort();

            datasOrdenadas.forEach(data => {
                if (y > 260) { doc.addPage(); y = 20; }
                
                doc.setFont(undefined, 'bold');
                doc.setFillColor(240, 240, 240);
                doc.rect(20, y-5, 170, 7, 'F');
                doc.text(`DIA: ${this.formatarDataBR(data)}`, 22, y);
                y += 10;
                
                agrupado[data].forEach(p => {
                    if (y > 270) { doc.addPage(); y = 20; }
                    doc.setFont(undefined, 'normal');
                    doc.text(`• ${p.municipio} (${p.uf}) - KM: ${p.km_total} | Hospedagem: R$ ${p.vr_hospedagem} | Jantar: R$ ${p.vr_jantar}`, 25, y);
                    y += 6;
                    p.orgaosSelecionados.forEach(o => {
                        doc.setFontSize(9); 
                        doc.text(`  - ${o.nome_orgao} (${o.sistema_fonte})`, 30, y); 
                        y += 4;
                    });
                    doc.setFontSize(10); 
                    y += 4;
                });
                y += 5;
            });
            
            if (y > 260) { doc.addPage(); y = 20; }
            doc.line(20, y, 190, y); y += 10;
            doc.setFont(undefined, 'bold');
            doc.text(`QUILOMETRAGEM TOTAL: ${this.calcularTotalKM} km`, 20, y);
            doc.text(`CUSTO ESTIMADO TOTAL: R$ ${this.calcularTotalCustos}`, 110, y);
            
            doc.save(`Roteiro_Licitanet_${new Date().getTime()}.pdf`);
        },

        // --- GEMINI IA E GOOGLE MAPS ---
        async gerarRotaPorPrompt() {
            if (!this.promptGestor) return;
            this.carregandoIA = true;
            
            try {
                const instrucao = `Aja como um assistente logístico. Extraia as cidades do texto e retorne APENAS um array JSON puro. 
                Formato: [{"municipio": "Nome da Cidade", "uf": "Sigla", "data": "YYYY-MM-DD"}]
                Use a data de hoje (${new Date().toISOString().split('T')[0]}) como base se o usuário não especificar.
                Texto: ${this.promptGestor}`;

                const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ parts: [{ text: instrucao }] }] })
                });

                if (!response.ok) {
                    const erro = await response.json();
                    throw new Error(erro.error?.message || "Erro na API do Google");
                }

                const data = await response.json();
                let textoIA = data.candidates[0].content.parts[0].text;
                
                const jsonMatch = textoIA.match(/\[[\s\S]*\]/);
                if (!jsonMatch) throw new Error("Formato de lista inválido retornado pela IA.");
                
                const cidadesExtraidas = JSON.parse(jsonMatch[0]);

                for (const item of cidadesExtraidas) {
                    this.planejadorUF = item.uf.toUpperCase();
                    this.novaCidadeRota.data_visita = item.data || new Date().toISOString().split('T')[0];
                    this.selecionarCidadePlanejador(item.municipio);
                    if (this.novaCidadeRota.municipio) {
                        this.adicionarCidadeARota();
                    }
                }
                
                this.promptGestor = ''; 
                alert(`✨ Roteiro gerado! Adicionamos ${cidadesExtraidas.length} paradas.`);

            } catch (error) {
                console.error(error);
                alert("Erro ao processar: " + error.message);
            } finally {
                this.carregandoIA = false;
            }
        },

        async calcularKMsGoogleMaps() {
            if (this.rotaEmPlanejamento.passos.length === 0) return;
            if (typeof google === 'undefined' || typeof google.maps === 'undefined') {
                alert("A API do Google Maps não foi encontrada. Verifique sua chave no HTML.");
                return;
            }

            this.calculandoKM = true;
            const BASE = "Uberlândia, MG, Brasil";
            
            // Pega os passos ordenados por data para calcular a rota na sequência certa
            const passosOrdenados = [...this.rotaEmPlanejamento.passos].sort((a,b) => new Date(a.data_visita) - new Date(b.data_visita));
            
            let sequencia = [BASE];
            passosOrdenados.forEach(p => sequencia.push(`${p.municipio}, ${p.uf}, Brasil`));
            sequencia.push(BASE);

            try {
                const service = new google.maps.DistanceMatrixService();
                
                for (let i = 0; i < passosOrdenados.length; i++) {
                    const request = {
                        origins: [sequencia[i]],
                        destinations: [sequencia[i + 1]],
                        travelMode: 'DRIVING',
                        unitSystem: google.maps.UnitSystem.METRIC,
                    };

                    await new Promise((resolve) => {
                        service.getDistanceMatrix(request, (response, status) => {
                            if (status === 'OK' && response.rows[0].elements[0].status === 'OK') {
                                const km = Math.round(response.rows[0].elements[0].distance.value / 1000);
                                // Encontra o item original no array bagunçado pelo ID temporário e atualiza
                                const passoOriginal = this.rotaEmPlanejamento.passos.find(p => p.id_temp === passosOrdenados[i].id_temp);
                                if (passoOriginal) {
                                    passoOriginal.km_estrada = km;
                                    passoOriginal.km_total = km + parseFloat(passoOriginal.km_cidade);
                                }
                            }
                            resolve();
                        });
                    });
                }
                
                service.getDistanceMatrix({ origins: [sequencia[sequencia.length - 2]], destinations: [BASE], travelMode: 'DRIVING' }, (response, status) => {
                    let avisoVolta = "";
                    if (status === 'OK' && response.rows[0].elements[0].status === 'OK') {
                        avisoVolta = `O retorno para Uberlândia dará +${Math.round(response.rows[0].elements[0].distance.value / 1000)} km.`;
                    }
                    alert(`🗺️ Cálculo Finalizado! Quilometragens atualizadas. \n${avisoVolta}`);
                });

            } catch (error) {
                console.error(error);
                alert("Falha ao calcular rota.");
            } finally {
                this.calculandoKM = false;
            }
        }
    }
}).mount('#app');