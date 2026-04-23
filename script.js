// ==============================
// MONVY — LÓGICA COMPLETA
// ==============================
import {
  onAuth, fazerLogout as fbLogout, getPerfil,
  ouvirMovimentacoes, adicionarMovimentacao, deletarMovimentacao,
  getMetas, adicionarMeta, atualizarMeta, deletarMeta,
  getDividas, adicionarDivida, atualizarDivida, deletarDivida,
  salvarPerfilVida as fbSalvarPerfilVida,
  salvarPerfil as fbSalvarPerfil,
  auth, db
} from './firebase.js';

// Expor auth e db para scripts inline do index.html
window._firebaseExports = { auth, db };

let currentUser = null;
let unsubMovimentacoes = null;

let saldo = 0, totalEntradas = 0, totalSaidas = 0;
let movimentacoes = [], metas = [];
let tipoAtual = '', metaAtualIndex = -1, respostaPergunta = '';
let editandoIndex = -1, filtroAtual = 'mes', relatorioMesOffset = 0;

const pageTitles = { inicio:'Dashboard', gastos:'Gastos', metas:'Metas', dividas:'Dívidas', investimentos:'Investimentos', aprender:'Aprender', relatorio:'Relatório Mensal' };
const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

// NAVEGAÇÃO
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', function(e) { e.preventDefault(); irPara(this.dataset.tela); });
});

function irPara(tela) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.tela').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('[data-tela="'+tela+'"]').forEach(el => el.classList.add('active'));
  const telaEl = document.getElementById('tela-'+tela);
  if (telaEl) telaEl.classList.add('active');
  const titulo = pageTitles[tela] || 'Monvy';
  document.getElementById('page-title').textContent = titulo;
  const mobileTelaEl = document.getElementById('topbar-mobile-tela');
  if (mobileTelaEl) mobileTelaEl.textContent = titulo;
  if (tela === 'gastos') atualizarTelaCategorias();
  if (tela === 'relatorio') atualizarRelatorio();
}

// FORMATO
function fmt(v) { return 'R$ '+Math.abs(v).toFixed(2).replace('.',',').replace(/\B(?=(\d{3})+(?!\d))/g,'.'); }
function fmtData(iso) { if (!iso) return ''; const [y,m,d]=iso.split('-'); return d+'/'+m+'/'+y; }
function hojeISO() { return new Date().toISOString().slice(0,10); }

// KPIs
function atualizarKPIs() {
  document.getElementById('saldo-display').textContent = fmt(saldo);
  document.getElementById('saldo-mes').textContent = 'Este mês: +'+fmt(totalEntradas)+' entrou';
  document.getElementById('kpi-entradas').textContent = fmt(totalEntradas);
  document.getElementById('kpi-saidas').textContent = fmt(totalSaidas);
  document.getElementById('kpi-movs').textContent = movimentacoes.length;
}

// CHART FLUXO
let chartInstance = null;
function atualizarChart() {
  const canvas = document.getElementById('chart-fluxo');
  const emptyEl = document.getElementById('chart-empty');
  if (!canvas) return;
  if (movimentacoes.length === 0) { canvas.style.display='none'; emptyEl.style.display='flex'; return; }
  canvas.style.display='block'; emptyEl.style.display='none';
  const ultimas = movimentacoes.slice(-8);
  const labels = ultimas.map((m,i) => '#'+(movimentacoes.indexOf(m)+1));
  if (chartInstance) chartInstance.destroy();
  const ctx = canvas.getContext('2d');
  const gG = ctx.createLinearGradient(0,0,0,180); gG.addColorStop(0,'rgba(34,197,94,0.3)'); gG.addColorStop(1,'rgba(34,197,94,0)');
  const gR = ctx.createLinearGradient(0,0,0,180); gR.addColorStop(0,'rgba(239,68,68,0.25)'); gR.addColorStop(1,'rgba(239,68,68,0)');
  chartInstance = new Chart(ctx, { type:'line', data:{ labels, datasets:[
    { label:'Entradas', data:ultimas.map(m=>m.tipo==='ganho'?m.valor:0), borderColor:'#22C55E', backgroundColor:gG, borderWidth:2, tension:0.4, fill:true, pointBackgroundColor:'#22C55E', pointRadius:4 },
    { label:'Saídas', data:ultimas.map(m=>m.tipo==='gasto'?m.valor:0), borderColor:'#EF4444', backgroundColor:gR, borderWidth:2, tension:0.4, fill:true, pointBackgroundColor:'#EF4444', pointRadius:4 }
  ]}, options:{ responsive:true, maintainAspectRatio:true, interaction:{intersect:false,mode:'index'},
    plugins:{ legend:{display:false}, tooltip:{backgroundColor:'#1A2235',borderColor:'rgba(255,255,255,0.08)',borderWidth:1,titleColor:'#94A3B8',bodyColor:'#fff',padding:10, callbacks:{label:c=>' '+c.dataset.label+': R$ '+c.raw.toFixed(2).replace('.',',')}}},
    scales:{ x:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#64748B',font:{size:11}}}, y:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#64748B',font:{size:11},callback:v=>'R$'+v.toFixed(0)}} }
  }});
}

// CHART PIZZA
let chartPizza = null;
let tipoGraficoPizza = 'doughnut'; // 'doughnut' ou 'bar'

function setTipoGrafico(tipo) {
  tipoGraficoPizza = tipo;
  // Atualizar estilos dos botões
  const btnPizza = document.getElementById('btn-tipo-pizza');
  const btnColuna = document.getElementById('btn-tipo-coluna');
  if (btnPizza && btnColuna) {
    if (tipo === 'doughnut') {
      btnPizza.style.background = 'var(--primary)';
      btnPizza.style.color = '#000';
      btnColuna.style.background = 'transparent';
      btnColuna.style.color = 'var(--gray)';
    } else {
      btnColuna.style.background = 'var(--primary)';
      btnColuna.style.color = '#000';
      btnPizza.style.background = 'transparent';
      btnPizza.style.color = 'var(--gray)';
    }
  }
  // Re-renderizar com os dados atuais
  if (chartPizza) {
    const labels = chartPizza.data.labels;
    const data = chartPizza.data.datasets[0].data;
    const cats = {};
    labels.forEach((l, i) => cats[l] = data[i]);
    atualizarChartPizza(cats);
  }
}

function atualizarChartPizza(cats) {
  const canvas = document.getElementById('chart-pizza');
  const emptyEl = document.getElementById('pizza-empty');
  const legendaEl = document.getElementById('pizza-legenda');
  if (!canvas) return;
  const total = Object.values(cats).reduce((a,b)=>a+b,0);
  if (total === 0) { canvas.style.display='none'; if(emptyEl)emptyEl.style.display='flex'; if(legendaEl)legendaEl.innerHTML=''; return; }
  canvas.style.display='block'; if(emptyEl)emptyEl.style.display='none';
  const labels = Object.keys(cats).filter(k=>cats[k]>0);
  const data = labels.map(k=>cats[k]);
  const cores = ['#22C55E','#3B82F6','#F59E0B','#EF4444','#A855F7','#64748B'];
  if (chartPizza) chartPizza.destroy();

  if (tipoGraficoPizza === 'bar') {
    // Gráfico de colunas
    chartPizza = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: { labels, datasets: [{ data, backgroundColor: cores.slice(0, labels.length), borderWidth: 0, borderRadius: 6 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + fmt(c.raw) + ' (' + ((c.raw/total)*100).toFixed(0) + '%)' } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 10 } } },
          y: { grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 10 }, callback: v => 'R$' + v } }
        }
      }
    });
    if (legendaEl) legendaEl.innerHTML = '';
  } else {
    // Gráfico de rosca (doughnut)
    chartPizza = new Chart(canvas.getContext('2d'), { type:'doughnut', data:{ labels, datasets:[{data, backgroundColor:cores.slice(0,labels.length), borderWidth:0, hoverOffset:6}]},
      options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false}, tooltip:{callbacks:{label:c=>' '+c.label+': '+fmt(c.raw)+' ('+((c.raw/total)*100).toFixed(0)+'%)'}}}, cutout:'60%' }
    });
    if (legendaEl) {
      legendaEl.innerHTML = labels.map((l,i)=>`<div class="pizza-leg-item"><span style="width:10px;height:10px;border-radius:50%;background:${cores[i]};flex-shrink:0;display:inline-block"></span><span style="font-size:.78rem;color:var(--gray)">${l}</span><span style="font-size:.78rem;font-weight:600;color:var(--white);margin-left:auto">${((data[i]/total)*100).toFixed(0)}%</span></div>`).join('');
    }
  }
}

// FILTRO
function setFiltro(filtro, btn) {
  filtroAtual = filtro;
  document.querySelectorAll('.filtro-btn').forEach(b=>b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  atualizarTelaCategorias();
}

function movsFiltradas() {
  const agora = new Date();
  return movimentacoes.filter(m => {
    if (filtroAtual==='todos'||!m.data) return true;
    const d = new Date(m.data+'T00:00:00');
    if (filtroAtual==='mes') return d.getMonth()===agora.getMonth()&&d.getFullYear()===agora.getFullYear();
    if (filtroAtual==='3meses') { const lim=new Date(agora); lim.setMonth(lim.getMonth()-3); return d>=lim; }
    if (filtroAtual==='ano') return d.getFullYear()===agora.getFullYear();
    return true;
  });
}

// LISTA INÍCIO
function atualizarListaInicio() {
  const lista = document.getElementById('lista-inicio');
  if (movimentacoes.length===0) { lista.innerHTML='<div class="vazio">Nenhuma movimentação ainda. Comece registrando!</div>'; return; }
  lista.innerHTML = [...movimentacoes].reverse().slice(0,8).map(m=>`
    <div class="mov-item">
      <div class="mov-left">
        <div class="mov-dot ${m.tipo==='ganho'?'g':'r'}"></div>
        <div class="mov-info">
          <span class="mov-desc">${m.descricao||(m.tipo==='ganho'?'Entrada':'Saída')}</span>
          <span class="mov-cat">${m.data?fmtData(m.data)+' · ':''}${m.tipo==='ganho'?'Entrada':m.categoria}</span>
        </div>
      </div>
      <span class="mov-valor ${m.tipo==='ganho'?'positivo':'negativo'}">${m.tipo==='ganho'?'+':'-'}${fmt(m.valor)}</span>
    </div>`).join('');
}

// MODAL REGISTRAR
function abrirModal(tipo) {
  tipoAtual=tipo; respostaPergunta='';
  document.getElementById('modal-titulo').textContent = tipo==='ganho'?'Registrar Entrada':'Registrar Saída';
  document.getElementById('modal-valor').value='';
  document.getElementById('modal-descricao').value='';
  document.getElementById('modal-data').value=hojeISO();
  document.getElementById('modal-recorrente').checked=false;
  document.getElementById('modal-categoria-area').style.display=tipo==='gasto'?'block':'none';
  document.getElementById('modal-pergunta').classList.add('hidden');
  document.getElementById('btn-confirmar').classList.remove('hidden');
  document.getElementById('modal').classList.remove('hidden');
}

function fecharModal() { document.getElementById('modal').classList.add('hidden'); }

async function confirmarModal() {
  const valor = parseFloat(document.getElementById('modal-valor').value);
  if (!valor||valor<=0) { alert('Digite um valor válido!'); return; }
  if (tipoAtual==='gasto'&&respostaPergunta==='') {
    document.getElementById('modal-pergunta').classList.remove('hidden');
    document.getElementById('btn-confirmar').classList.add('hidden');
    return;
  }
  const catEl = document.getElementById('modal-categoria');
  const categoria = (tipoAtual === 'gasto' && catEl) ? (catEl.value || 'Outros') : '';
  await registrar(
    valor,
    document.getElementById('modal-descricao').value || (tipoAtual==='ganho' ? 'Entrada' : 'Saída'),
    categoria,
    document.getElementById('modal-data').value || hojeISO(),
    document.getElementById('modal-recorrente').checked
  );
  fecharModal();
}

async function responderPergunta(resposta) {
  respostaPergunta = resposta;
  const valor = parseFloat(document.getElementById('modal-valor').value);
  if (resposta==='desejo') {
    if (!confirm('Isso é um desejo!\n\nVocê tem certeza que quer gastar?\n\nPense bem antes de confirmar')) {
      fecharModal(); return;
    }
  }
  const catEl = document.getElementById('modal-categoria');
  const categoria = catEl ? (catEl.value || 'Outros') : 'Outros';
  await registrar(
    valor,
    document.getElementById('modal-descricao').value || 'Saída',
    categoria,
    document.getElementById('modal-data').value || hojeISO(),
    document.getElementById('modal-recorrente').checked
  );
  fecharModal();
}

async function registrar(valor, descricao, categoria, data, recorrente) {
  if (!currentUser) { alert('Você precisa estar logado.'); return; }
  // Garantir que nenhum campo seja undefined (Firestore rejeita undefined)
  const mov = {
    tipo: tipoAtual,
    valor: Number(valor),
    descricao: descricao || (tipoAtual === 'ganho' ? 'Entrada' : 'Saída'),
    categoria: categoria || '',
    data: data || hojeISO(),
    recorrente: !!recorrente,
    resposta: respostaPergunta || ''
  };
  try {
    await adicionarMovimentacao(currentUser.uid, mov);
  } catch(e) {
    console.error('Erro ao salvar movimentação:', e);
    const msg = e && e.code === 'permission-denied'
      ? 'Sem permissão para salvar. Verifique as regras do Firestore.'
      : 'Erro ao salvar. Tente novamente.';
    alert(msg);
  }
}

function recalcular() { recalcularTotais(); atualizarKPIs(); atualizarListaInicio(); }

// Aliases para compatibilidade Firebase
function atualizarListaMetas() { renderizarMetas(); }
function renderizarMovimentacoes() { atualizarListaInicio(); }
function recalcularTotais() {
  saldo=0; totalEntradas=0; totalSaidas=0;
  movimentacoes.forEach(m=>{ if(m.tipo==='ganho'){saldo+=m.valor;totalEntradas+=m.valor;}else{saldo-=m.valor;totalSaidas+=m.valor;} });
}

// EDITAR / EXCLUIR
function abrirModalEditar(index) {
  editandoIndex=index;
  const m = movimentacoes[index];
  document.getElementById('edit-valor').value=m.valor;
  document.getElementById('edit-descricao').value=m.descricao||'';
  document.getElementById('edit-data').value=m.data||hojeISO();
  document.getElementById('edit-categoria-area').style.display=m.tipo==='gasto'?'block':'none';
  if (m.tipo==='gasto') document.getElementById('edit-categoria').value=m.categoria||'Outros';
  document.getElementById('modal-editar').classList.remove('hidden');
}

function fecharModalEditar() { document.getElementById('modal-editar').classList.add('hidden'); editandoIndex=-1; }

async function salvarEdicao() {
  const valor = parseFloat(document.getElementById('edit-valor').value);
  if (!valor||valor<=0) { alert('Digite um valor válido!'); return; }
  if (!currentUser) return;
  const m = movimentacoes[editandoIndex];
  if (!m || !m.id) return;
  const catEl = document.getElementById('edit-categoria');
  const dados = {
    valor: Number(valor),
    descricao: document.getElementById('edit-descricao').value || (m.tipo==='ganho' ? 'Entrada' : 'Saída'),
    data: document.getElementById('edit-data').value || hojeISO(),
    categoria: m.tipo==='gasto' ? (catEl ? catEl.value || 'Outros' : 'Outros') : (m.categoria || ''),
    recorrente: !!m.recorrente,
    resposta: m.resposta || ''
  };
  try {
    await deletarMovimentacao(currentUser.uid, m.id);
    const tipo = m.tipo;
    tipoAtual = tipo;
    await adicionarMovimentacao(currentUser.uid, { tipo, ...dados });
  } catch(e) {
    console.error('Erro ao editar:', e);
    alert('Erro ao salvar edição. Tente novamente.');
  }
  fecharModalEditar();
}

async function excluirMovimentacao() {
  if (!confirm('Excluir esta movimentação?')) return;
  if (!currentUser) return;
  const mov = movimentacoes[editandoIndex];
  if (mov && mov.id) {
    try {
      await deletarMovimentacao(currentUser.uid, mov.id);
      // onSnapshot atualiza automaticamente
    } catch(e) { console.error('Erro ao excluir:', e); }
  }
  fecharModalEditar();
}

// GASTOS
function atualizarTelaCategorias_v16_legado() {
  // Substituída pelo Módulo 2 — versão adaptativa no final do arquivo
}

// METAS
async function criarMeta() {
  const nome=document.getElementById('meta-nome').value.trim(), valor=parseFloat(document.getElementById('meta-valor').value);
  if (!nome||!valor||valor<=0) { alert('Preencha nome e valor!'); return; }
  if (!currentUser) return;
  try {
    const id = await adicionarMeta(currentUser.uid, {nome, objetivo:valor, atual:0});
    metas.push({id, nome, objetivo:valor, atual:0});
    document.getElementById('meta-nome').value=''; document.getElementById('meta-valor').value='';
    renderizarMetas();
  } catch(e) { console.error('Erro ao criar meta:', e); }
}

function renderizarMetas() {
  const lista=document.getElementById('lista-metas');
  if (metas.length===0) { lista.innerHTML='<div class="vazio">Nenhuma meta ainda.</div>'; return; }
  lista.innerHTML=metas.map((m,i)=>{
    const pct=Math.min(100,Math.round((m.atual/m.objetivo)*100));
    return `<div class="meta-card"><div class="meta-topo"><span class="meta-nome">${m.nome}</span><span class="meta-valores">${fmt(m.atual)} / ${fmt(m.objetivo)}</span></div><div class="meta-barra-bg"><div class="meta-barra-fill" style="width:${pct}%"></div></div><div class="meta-rodape"><span class="meta-pct">${pct}% concluído</span><button class="btn-meta" onclick="abrirModalMeta(${i})">+ Adicionar</button></div></div>`;
  }).join('');
}

function abrirModalMeta(index) {
  metaAtualIndex=index;
  document.getElementById('modal-meta-nome-display').textContent=metas[index].nome;
  document.getElementById('modal-meta-valor').value='';
  document.getElementById('modal-meta').classList.remove('hidden');
}

function fecharModalMeta() { document.getElementById('modal-meta').classList.add('hidden'); }

async function adicionarValorMeta() {
  const valor=parseFloat(document.getElementById('modal-meta-valor').value);
  if (!valor||valor<=0) { alert('Digite um valor válido!'); return; }
  if (!currentUser) return;
  const meta = metas[metaAtualIndex];
  if (!meta) return;
  meta.atual += valor;
  try {
    if (meta.id) await atualizarMeta(currentUser.uid, meta.id, {atual: meta.atual});
  } catch(e) { console.error('Erro ao atualizar meta:', e); }
  fecharModalMeta(); renderizarMetas();
}

// DÍVIDAS
function calcularDivida() {
  const valor=parseFloat(document.getElementById('sim-valor').value), juros=parseFloat(document.getElementById('sim-juros').value)/100, parcelas=parseInt(document.getElementById('sim-parcelas').value);
  if (!valor||!juros||!parcelas) { alert('Preencha valor, juros e parcelas para simular!'); return; }
  const parcela=valor*(juros*Math.pow(1+juros,parcelas))/(Math.pow(1+juros,parcelas)-1), total=parcela*parcelas, jurosTotal=total-valor, pct=((jurosTotal/valor)*100).toFixed(0);
  document.getElementById('div-original').textContent=fmt(valor); document.getElementById('div-juros-total').textContent=fmt(jurosTotal);
  document.getElementById('div-total').textContent=fmt(total); document.getElementById('div-parcela').textContent=fmt(parcela)+'/mês';
  document.getElementById('div-alerta').textContent='Você vai pagar '+pct+'% a mais do valor original! Em '+parcelas+' meses, '+fmt(jurosTotal)+' vai para juros.';
  document.getElementById('resultado-divida').classList.remove('hidden');
}

// INVESTIMENTOS
function calcularInvestimentos() {
  const valor=parseFloat(document.getElementById('inv-valor').value), meses=parseInt(document.getElementById('inv-meses').value);
  if (!valor||!meses) { alert('Preencha todos os campos!'); return; }
  const calc=t=>valor*Math.pow(1+t,meses), tp=calc(0.005), ts=calc(0.009), tc=calc(0.01);
  document.getElementById('inv-poupanca').textContent=fmt(tp); document.getElementById('inv-poupanca-ganho').textContent='+'+fmt(tp-valor)+' de rendimento';
  document.getElementById('inv-selic').textContent=fmt(ts); document.getElementById('inv-selic-ganho').textContent='+'+fmt(ts-valor)+' de rendimento';
  document.getElementById('inv-cdb').textContent=fmt(tc); document.getElementById('inv-cdb-ganho').textContent='+'+fmt(tc-valor)+' de rendimento';
  document.getElementById('resultado-inv').classList.remove('hidden');
}

// RELATÓRIO MENSAL
let chartRelatorio = null;

function mudarMesRelatorio(delta) { relatorioMesOffset+=delta; atualizarRelatorio(); }

// Modo do período: 'mes' ou 'custom'
let periodoModo = 'mes';
let periodoCustomInicio = null, periodoCustomFim = null;

function setPeriodoModo(modo) {
  periodoModo = modo;
  document.getElementById('tab-mes').classList.toggle('active', modo === 'mes');
  document.getElementById('tab-custom').classList.toggle('active', modo === 'custom');
  document.getElementById('periodo-mes-nav').style.display = modo === 'mes' ? 'flex' : 'none';
  document.getElementById('periodo-custom-nav').style.display = modo === 'custom' ? 'block' : 'none';
  if (modo === 'custom' && !periodoCustomInicio) {
    // Pré-preencher com o mês atual
    const agora = new Date();
    const primeiro = new Date(agora.getFullYear(), agora.getMonth(), 1);
    const ultimo = new Date(agora.getFullYear(), agora.getMonth() + 1, 0);
    document.getElementById('periodo-inicio').value = primeiro.toISOString().split('T')[0];
    document.getElementById('periodo-fim').value = ultimo.toISOString().split('T')[0];
    periodoCustomInicio = primeiro.toISOString().split('T')[0];
    periodoCustomFim = ultimo.toISOString().split('T')[0];
  }
  atualizarRelatorio();
}

function aplicarPeriodoCustom() {
  periodoCustomInicio = document.getElementById('periodo-inicio').value;
  periodoCustomFim = document.getElementById('periodo-fim').value;
  if (periodoCustomInicio && periodoCustomFim) atualizarRelatorio();
}

function atalhoUltimos(dias) {
  const fim = new Date();
  const inicio = new Date();
  inicio.setDate(inicio.getDate() - (dias - 1));
  const fmt2 = d => d.toISOString().split('T')[0];
  document.getElementById('periodo-inicio').value = fmt2(inicio);
  document.getElementById('periodo-fim').value = fmt2(fim);
  periodoCustomInicio = fmt2(inicio);
  periodoCustomFim = fmt2(fim);
  atualizarRelatorio();
}

function getMovimentacoesPeriodo() {
  if (periodoModo === 'mes') {
    const agora = new Date(), alvo = new Date(agora.getFullYear(), agora.getMonth() + relatorioMesOffset, 1);
    return {
      movs: movimentacoes.filter(m => {
        if (!m.data) return false;
        const d = new Date(m.data + 'T00:00:00');
        return d.getMonth() === alvo.getMonth() && d.getFullYear() === alvo.getFullYear();
      }),
      alvo
    };
  } else {
    const ini = periodoCustomInicio ? new Date(periodoCustomInicio + 'T00:00:00') : null;
    const fim = periodoCustomFim ? new Date(periodoCustomFim + 'T23:59:59') : null;
    return {
      movs: movimentacoes.filter(m => {
        if (!m.data) return false;
        const d = new Date(m.data + 'T00:00:00');
        return (!ini || d >= ini) && (!fim || d <= fim);
      }),
      alvo: ini || new Date()
    };
  }
}

function atualizarRelatorio() {
  const agora = new Date(), alvo = new Date(agora.getFullYear(), agora.getMonth() + relatorioMesOffset, 1);
  document.getElementById('relatorio-mes-label').textContent = MESES[alvo.getMonth()] + ' ' + alvo.getFullYear();

  const { movs: doMes, alvo: alvoReal } = getMovimentacoesPeriodo();

  // Label período custom
  const labelEl = document.getElementById('periodo-custom-label');
  if (labelEl && periodoModo === 'custom' && periodoCustomInicio && periodoCustomFim) {
    const ini = periodoCustomInicio.split('-').reverse().join('/');
    const fim = periodoCustomFim.split('-').reverse().join('/');
    labelEl.textContent = ini === fim ? 'Dia ' + ini : 'De ' + ini + ' até ' + fim;
  } else if (labelEl) {
    labelEl.textContent = '';
  }

  const entradas = doMes.filter(m => m.tipo === 'ganho').reduce((a, m) => a + m.valor, 0);
  const saidas = doMes.filter(m => m.tipo === 'gasto').reduce((a, m) => a + m.valor, 0);
  const saldoMes = entradas - saidas;
  document.getElementById('rel-entradas').textContent = fmt(entradas);
  document.getElementById('rel-saidas').textContent = fmt(saidas);
  const saldoEl = document.getElementById('rel-saldo');
  saldoEl.textContent = fmt(saldoMes);
  saldoEl.className = 'kpi-value ' + (saldoMes >= 0 ? 'green' : 'red');
  document.getElementById('rel-total').textContent = doMes.length;

  const topEl = document.getElementById('relatorio-top-gastos');
  const gastosMes = doMes.filter(m => m.tipo === 'gasto').sort((a, b) => b.valor - a.valor).slice(0, 5);
  topEl.innerHTML = gastosMes.length === 0
    ? '<div class="vazio">Nenhum gasto no período.</div>'
    : gastosMes.map(m => `<div class="mov-item"><div class="mov-left"><div class="mov-dot r"></div><div class="mov-info"><span class="mov-desc">${m.descricao}</span><span class="mov-cat">${m.categoria} · ${fmtData(m.data)}</span></div></div><span class="mov-valor negativo">-${fmt(m.valor)}</span></div>`).join('');

  atualizarChartRelatorio(alvoReal);
  atualizarListaRecorrentes();
}

function atualizarChartRelatorio(alvo) {
  const canvas=document.getElementById('chart-relatorio'), emptyEl=document.getElementById('relatorio-chart-empty');
  if (!canvas) return;
  const dados=[];
  for (let i=5;i>=0;i--) {
    const d=new Date(alvo.getFullYear(),alvo.getMonth()-i,1);
    const mv=movimentacoes.filter(m=>{ if(!m.data)return false; const md=new Date(m.data+'T00:00:00'); return md.getMonth()===d.getMonth()&&md.getFullYear()===d.getFullYear(); });
    dados.push({ label:MESES[d.getMonth()].slice(0,3), entradas:mv.filter(m=>m.tipo==='ganho').reduce((a,m)=>a+m.valor,0), saidas:mv.filter(m=>m.tipo==='gasto').reduce((a,m)=>a+m.valor,0) });
  }
  if (!dados.some(d=>d.entradas>0||d.saidas>0)) { canvas.style.display='none'; if(emptyEl)emptyEl.style.display='flex'; return; }
  canvas.style.display='block'; if(emptyEl)emptyEl.style.display='none';
  if (chartRelatorio) chartRelatorio.destroy();
  chartRelatorio=new Chart(canvas.getContext('2d'),{ type:'bar', data:{ labels:dados.map(d=>d.label), datasets:[
    {label:'Entradas',data:dados.map(d=>d.entradas),backgroundColor:'rgba(34,197,94,0.7)',borderRadius:6},
    {label:'Saídas',data:dados.map(d=>d.saidas),backgroundColor:'rgba(239,68,68,0.7)',borderRadius:6}
  ]}, options:{ responsive:true, maintainAspectRatio:true,
    plugins:{legend:{labels:{color:'#64748B',font:{size:11}}},tooltip:{backgroundColor:'#1A2235',borderColor:'rgba(255,255,255,0.08)',borderWidth:1,titleColor:'#94A3B8',bodyColor:'#fff',callbacks:{label:c=>' '+c.dataset.label+': '+fmt(c.raw)}}},
    scales:{x:{grid:{display:false},ticks:{color:'#64748B',font:{size:11}}},y:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#64748B',font:{size:11},callback:v=>'R$'+v.toFixed(0)}}}
  }});
}

// RECORRENTES
function atualizarListaRecorrentes() {
  const lista=document.getElementById('lista-recorrentes');
  if (!lista) return;
  const visto=new Set(), unicos=[];
  movimentacoes.filter(m=>m.recorrente).forEach(m=>{ const k=m.descricao+'|'+m.categoria+'|'+m.tipo; if(!visto.has(k)){visto.add(k);unicos.push(m);} });
  lista.innerHTML=unicos.length===0?'<div class="vazio" style="padding:16px 20px">Nenhum lançamento recorrente cadastrado.<br><span style="font-size:.8rem;opacity:.6">Marque "recorrente" ao registrar uma entrada ou saída.</span></div>':
    unicos.map(m=>`<div class="mov-item" style="padding:12px 20px"><div class="mov-left"><div class="mov-dot ${m.tipo==='ganho'?'g':'r'}"></div><div class="mov-info"><span class="mov-desc">${m.descricao} <span style="font-size:.7rem;background:rgba(57,255,121,0.15);color:var(--primary);padding:1px 6px;border-radius:4px">mensal</span></span><span class="mov-cat">${m.tipo==='ganho'?'Entrada':m.categoria}</span></div></div><span class="mov-valor ${m.tipo==='ganho'?'positivo':'negativo'}">${m.tipo==='ganho'?'+':'-'}${fmt(m.valor)}</span></div>`).join('');
}

function processarRecorrentes() {
  const agora=new Date(), visto=new Set(), unicos=[];
  movimentacoes.filter(m=>m.recorrente).forEach(m=>{ const k=m.descricao+'|'+m.categoria+'|'+m.tipo; if(!visto.has(k)){visto.add(k);unicos.push(m);} });
  if (unicos.length===0) { alert('Nenhum lançamento recorrente cadastrado.'); return; }
  const jaSet=new Set(movimentacoes.filter(m=>{ if(!m.data||!m.recorrente)return false; const d=new Date(m.data+'T00:00:00'); return d.getMonth()===agora.getMonth()&&d.getFullYear()===agora.getFullYear(); }).map(m=>m.descricao+'|'+m.categoria+'|'+m.tipo));
  const pendentes=unicos.filter(m=>!jaSet.has(m.descricao+'|'+m.categoria+'|'+m.tipo));
  if (pendentes.length===0) { alert('Todos os recorrentes já foram lançados neste mês!'); return; }
  if (!confirm('Lançar '+pendentes.length+' recorrente(s) para '+MESES[agora.getMonth()]+'?')) return;
  pendentes.forEach(m=>{ tipoAtual=m.tipo; movimentacoes.push({...m,data:hojeISO(),resposta:''}); });
  recalcularTotais(); atualizarKPIs(); atualizarListaInicio(); atualizarChart(); atualizarRelatorio();
  alert(pendentes.length+' lançamento(s) adicionado(s)!');
}

// ARTIGOS
const artigos=[
  {titulo:'Reserva de emergência',conteudo:`<h2>O que é reserva de emergência?</h2><p>Reserva de emergência é um dinheiro guardado exclusivamente para imprevistos: perder o emprego, um problema de saúde, um conserto urgente.</p><p><strong>Quanto guardar?</strong> O ideal é ter de 3 a 6 meses dos seus gastos mensais guardados.</p><p><strong>Onde guardar?</strong></p><ul><li>Tesouro Selic (recomendado)</li><li>CDB com liquidez diária</li><li>Conta remunerada</li></ul>`},
  {titulo:'Cartão de crédito',conteudo:`<h2>Por que evitar o cartão de crédito?</h2><p>O cartão de crédito não é dinheiro extra. É dinheiro adiantado que você vai ter que devolver.</p><p><strong>O perigo do rotativo:</strong> Juros de 15% a 20% ao mês.</p><p><strong>Regra de ouro:</strong> Se você precisa parcelar, provavelmente não pode comprar.</p>`},
  {titulo:'Sair das dívidas',conteudo:`<h2>Como sair das dívidas?</h2><p><strong>Passo 1:</strong> Liste todas as suas dívidas.</p><p><strong>Passo 2:</strong> Priorize as com maior juros.</p><p><strong>Passo 3:</strong> Negocie desconto para quitar à vista.</p><p><strong>Passo 4:</strong> Corte gastos desnecessários.</p>`},
  {titulo:'Necessidade vs Desejo',conteudo:`<h2>Necessidade vs Desejo</h2><p><strong>Necessidade</strong> é o que você precisa para viver: alimentação, moradia, saúde, transporte.</p><p><strong>Desejo</strong> é o que você quer: roupas de marca, restaurante caro, o celular mais novo.</p><p><strong>A regra das 24 horas:</strong> Esperou um dia e ainda quer? Talvez valha.</p>`},
  {titulo:'Regra 50-30-20',conteudo:`<h2>Regra dos 50-30-20</h2><p><strong>50%</strong> — Necessidades: Aluguel, mercado, contas, transporte.</p><p><strong>30%</strong> — Desejos: Lazer, roupas, restaurante, streaming.</p><p><strong>20%</strong> — Futuro: Reserva de emergência, investimentos.</p>`},
  {titulo:'Como começar a investir',conteudo:`<h2>Como começar a investir?</h2><p>Você não precisa ser rico para investir. Pode começar com R$ 30.</p><p><strong>Antes de investir:</strong> Quite suas dívidas de alto juros e monte sua reserva primeiro.</p><p><strong>O segredo:</strong> Consistência. Investir R$ 100 por mês todo mês é melhor que R$ 1.200 uma vez por ano.</p>`}
];

function abrirArtigo(index) { document.getElementById('artigo-conteudo').innerHTML=artigos[index].conteudo; document.getElementById('modal-artigo').classList.remove('hidden'); }
function fecharArtigo() { document.getElementById('modal-artigo').classList.add('hidden'); }

// FECHAR FORA
['modal','modal-artigo','modal-meta','modal-editar'].forEach(id=>{ const el=document.getElementById(id); if(el)el.addEventListener('click',function(e){if(e.target===this)this.classList.add('hidden');}); });

// AUTH & TEMA
async function logout() {
  if(confirm('Deseja sair da sua conta?')) {
    if (unsubMovimentacoes) unsubMovimentacoes();
    await fbLogout();
    localStorage.removeItem('monvy_theme');
    window.location.href = 'auth.html';
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme',theme);
  const moon=document.getElementById('theme-icon-moon'), sun=document.getElementById('theme-icon-sun');
  if(theme==='light'){if(moon)moon.style.display='none';if(sun)sun.style.display='block';}
  else{if(moon)moon.style.display='block';if(sun)sun.style.display='none';}
}

function toggleTheme() { const c=document.documentElement.getAttribute('data-theme')||'dark', n=c==='dark'?'light':'dark'; localStorage.setItem('monvy_theme',n); applyTheme(n); }

// ===== BUSCA =====
function _renderBuscaResultados(termo, header, lista) {
  const q = termo.trim().toLowerCase();
  const resultados = [...movimentacoes].filter(m => {
    return (
      (m.descricao && m.descricao.toLowerCase().includes(q)) ||
      (m.categoria && m.categoria.toLowerCase().includes(q)) ||
      (m.tipo === 'ganho' && 'entrada'.includes(q)) ||
      (m.tipo === 'gasto' && 'saída'.includes(q)) ||
      (m.data && fmtData(m.data).includes(q))
    );
  }).sort((a,b) => (b.data||'').localeCompare(a.data||''));

  header.textContent = resultados.length === 0
    ? 'Nenhum resultado para "' + termo + '"'
    : resultados.length + ' resultado' + (resultados.length > 1 ? 's' : '') + ' para "' + termo + '"';

  if (resultados.length === 0) {
    lista.innerHTML = '<div style="padding:24px 16px;text-align:center;color:var(--gray);font-size:.85rem">Nenhuma movimentação encontrada.</div>';
  } else {
    lista.innerHTML = resultados.map(m => {
      const idx = movimentacoes.indexOf(m);
      const isGanho = m.tipo === 'ganho';
      function highlight(txt) {
        if (!txt) return '';
        const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')', 'gi');
        return txt.replace(re, '<mark style="background:rgba(57,255,121,0.25);color:inherit;border-radius:3px;padding:0 2px">$1</mark>');
      }
      const closeCmd = 'fecharDropdownBusca()';
      return `<div class="mov-item" style="padding:12px 16px;border-bottom:1px solid var(--border);cursor:default">
        <div class="mov-left">
          <div class="mov-dot ${isGanho?'g':'r'}"></div>
          <div class="mov-info">
            <span class="mov-desc">${highlight(m.descricao||(isGanho?'Entrada':'Saída'))}</span>
            <span class="mov-cat">${m.data?fmtData(m.data)+' · ':''}${highlight(isGanho?'Entrada':m.categoria)}</span>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="mov-valor ${isGanho?'positivo':'negativo'}">${isGanho?'+':'-'}${fmt(m.valor)}</span>
          <button onclick="abrirModalEditar(${idx});${closeCmd}" style="background:none;border:none;cursor:pointer;color:var(--gray);padding:4px;border-radius:6px;font-size:.85rem" title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        </div>
      </div>`;
    }).join('');
  }
}

function buscarMovimentacoes(termo) {
  const clearBtn = document.getElementById('search-clear');
  if (clearBtn) clearBtn.style.display = termo.trim() ? 'inline-block' : 'none';
  if (!termo.trim()) { fecharDropdownBusca(); return; }
  mostrarDropdownBusca(termo);
}

function mostrarDropdownBusca(termo) {
  const dropdown = document.getElementById('search-dropdown');
  const header = document.getElementById('search-results-header');
  const lista = document.getElementById('search-results-list');
  if (!dropdown || !header || !lista) return;
  _renderBuscaResultados(termo, header, lista);
  dropdown.style.display = 'block';
}

function fecharDropdownBusca() {
  const dropdown = document.getElementById('search-dropdown');
  if (dropdown) dropdown.style.display = 'none';
}

function limparBusca() {
  const input = document.getElementById('search-input');
  if (input) input.value = '';
  const clearBtn = document.getElementById('search-clear');
  if (clearBtn) clearBtn.style.display = 'none';
  const inputM = document.getElementById('search-input-mobile');
  if (inputM) inputM.value = '';
  const clearBtnM = document.getElementById('search-clear-mobile');
  if (clearBtnM) clearBtnM.style.display = 'none';
  fecharDropdownBusca();
}

function abrirBuscaMobile() {
  const overlay = document.getElementById('search-mobile-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
    overlay.classList.add('open');
    setTimeout(() => {
      const input = document.getElementById('search-input-mobile');
      if (input) input.focus();
    }, 50);
  }
}

function fecharBuscaMobile() {
  const overlay = document.getElementById('search-mobile-overlay');
  if (overlay) {
    overlay.classList.remove('open');
    overlay.style.display = 'none';
  }
  limparBusca();
}

document.addEventListener('click', function(e) {
  const center = document.querySelector('.topbar-center');
  if (center && !center.contains(e.target)) fecharDropdownBusca();
});

// INIT
// ===== INIT FIREBASE =====
applyTheme(localStorage.getItem('monvy_theme')||'dark');

// Carregar Chart.js
const script=document.createElement('script');
script.src='https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
script.onload=()=>atualizarChart();
document.head.appendChild(script);

onAuth(async (user) => {
  if (!user) { window.location.href = 'auth.html'; return; }
  currentUser = user;

  // Preencher avatar e nome
  const nome = user.displayName || '';
  const avatarEl = document.getElementById('user-avatar');
  if (avatarEl) {
    if (user.photoURL) {
      avatarEl.innerHTML = '<img src="'+user.photoURL+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
    } else if (nome) {
      avatarEl.textContent = nome.charAt(0).toUpperCase();
    }
    avatarEl.title = nome;
  }
  const greetEl = document.getElementById('topbar-greeting');
  if (greetEl && nome) greetEl.textContent = 'Olá, ' + nome.split(' ')[0];
  const dataInput = document.getElementById('modal-data');
  if (dataInput) dataInput.value = hojeISO();

  // Verificar onboarding
  try {
    const perfil = await getPerfil(user.uid);
    // Checar onboarding: Firestore é a fonte principal, localStorage é o fallback
    const onboardingLocal = localStorage.getItem('monvy_onboarding_done') === '1';
    if (!perfil.onboardingDone && !onboardingLocal) {
      window.location.href = 'onboarding.html';
      return;
    }
    // Se localStorage indica feito mas Firestore não, sincronizar
    if (!perfil.onboardingDone && onboardingLocal) {
      try {
        const { marcarOnboardingFeito } = await import('./firebase.js');
        await marcarOnboardingFeito(user.uid);
      } catch(e) { console.warn('Erro ao sincronizar onboarding:', e); }
    }

    // Carregar perfil de vida para categorias
    if (perfil.perfilVida) {
      localStorage.setItem('monvy_perfil_vida', JSON.stringify(perfil.perfilVida));
    }

    // Sincronizar nome e foto do Firebase com localStorage e UI
    const nomeFirebase = perfil.nome || user.displayName || '';
    const fotoFirebase = perfil.foto || user.photoURL || null;
    if (nomeFirebase) {
      let userData = {};
      const raw = localStorage.getItem('monvy_logado') || localStorage.getItem('monvy_logged');
      if (raw) { try { userData = JSON.parse(raw); } catch(e){} }
      userData.nome = nomeFirebase; userData.name = nomeFirebase;
      const key = localStorage.getItem('monvy_logado') ? 'monvy_logado' : 'monvy_logged';
      localStorage.setItem(key, JSON.stringify(userData));
    }
    if (fotoFirebase && fotoFirebase.startsWith('data:')) {
      localStorage.setItem('monvy_avatar_foto', fotoFirebase);
    }
    if (typeof aplicarPerfilUI === 'function') {
      const fotoLocal = localStorage.getItem('monvy_avatar_foto');
      aplicarPerfilUI(nomeFirebase, fotoLocal || fotoFirebase || null);
    }

    // Carregar metas
    metas = await getMetas(user.uid);
    atualizarListaMetas();

    // Carregar dívidas
    dividasCadastradas = await getDividas(user.uid);
    if (typeof renderizarDividas === 'function') renderizarDividas();

    // Ouvir movimentações em tempo real
    if (unsubMovimentacoes) unsubMovimentacoes();
    unsubMovimentacoes = ouvirMovimentacoes(user.uid, (movs) => {
      movimentacoes = movs;
      recalcular();
      renderizarMovimentacoes();
      atualizarChart();
      atualizarTelaCategorias();
    });
  } catch(e) {
    console.error('Erro ao carregar dados:', e);
  }
});

// ==============================
// NOVOS MÓDULOS v17
// ==============================

// ===== DÍVIDAS CADASTRADAS =====
let dividasCadastradas = [];

const DIVIDA_ICONS = {
  cartao: '<img src="icone-cartao-novo.png" style="width:22px;height:22px;object-fit:contain;vertical-align:middle">',
  emprestimo: '<img src="icone-emprestimo.png" style="width:22px;height:22px;object-fit:contain;vertical-align:middle">',
  financiamento: '<img src="icone-banco.png" style="width:22px;height:22px;object-fit:contain;vertical-align:middle">',
  terceiros: '<img src="icone-terceiros.png" style="width:22px;height:22px;object-fit:contain;vertical-align:middle">',
  outros: '<img src="icone-outros.png" style="width:22px;height:22px;object-fit:contain;vertical-align:middle">'
};
const DIVIDA_LABELS = {
  cartao: 'Cartão de crédito', emprestimo: 'Empréstimo', financiamento: 'Financiamento', terceiros: 'Terceiros', outros: 'Outros'
};

function atualizarFormDivida() {
  const tipo = document.getElementById('div-tipo').value;
  const terceiroArea = document.getElementById('div-terceiro-area');
  const jurosArea = document.getElementById('div-juros-area');
  if (terceiroArea) terceiroArea.style.display = tipo === 'terceiros' ? 'block' : 'none';
  if (jurosArea) jurosArea.style.display = tipo === 'terceiros' ? 'none' : 'block';
}

async function cadastrarDivida() {
  const tipo = document.getElementById('div-tipo').value;
  const descricao = document.getElementById('div-descricao').value.trim();
  const valor = parseFloat(document.getElementById('div-valor').value);
  const jurosEl = document.getElementById('div-juros');
  const parcelasEl = document.getElementById('div-parcelas');
  const credorEl = document.getElementById('div-credor');

  if (!descricao || !valor || valor <= 0) {
    alert('Preencha a descrição e o valor da dívida.');
    return;
  }

  const divida = {
    id: Date.now(),
    tipo,
    descricao,
    valor,
    juros: jurosEl ? parseFloat(jurosEl.value) || 0 : 0,
    parcelas: parcelasEl ? parseInt(parcelasEl.value) || 0 : 0,
    credor: credorEl ? credorEl.value.trim() : '',
    dataCriacao: new Date().toISOString().slice(0,10)
  };

  if (currentUser) {
    try {
      const fbId = await adicionarDivida(currentUser.uid, divida);
      divida.id = fbId;
    } catch(e) { console.error('Erro ao salvar dívida:', e); }
  }
  dividasCadastradas.push(divida);
  renderizarDividas();
  atualizarKPIsDividas();

  // Limpar form
  document.getElementById('div-descricao').value = '';
  document.getElementById('div-valor').value = '';
  if (jurosEl) jurosEl.value = '';
  if (parcelasEl) parcelasEl.value = '';
  if (credorEl) credorEl.value = '';

  const sucesso = document.getElementById('div-form-sucesso');
  if (sucesso) { sucesso.style.display = 'block'; setTimeout(() => sucesso.style.display = 'none', 2000); }
}

async function excluirDivida(id) {
  if (!confirm('Remover esta dívida?')) return;
  if (currentUser) {
    try { await deletarDivida(currentUser.uid, id); } catch(e) { console.error(e); }
  }
  dividasCadastradas = dividasCadastradas.filter(d => d.id !== id);
  renderizarDividas();
  atualizarKPIsDividas();
}

async function salvarDividas() {
  // Dados já salvos individualmente no Firestore — sem ação necessária
}

function renderizarDividas() {
  const lista = document.getElementById('lista-dividas-cadastradas');
  const countEl = document.getElementById('div-lista-count');
  const estrategiaCard = document.getElementById('estrategia-card');
  if (!lista) return;

  if (countEl) countEl.textContent = dividasCadastradas.length + ' cadastrada' + (dividasCadastradas.length !== 1 ? 's' : '');

  if (dividasCadastradas.length === 0) {
    lista.innerHTML = '<div class="vazio">Nenhuma dívida cadastrada ainda.<br><span style="font-size:.8rem">Use o formulário ao lado para registrar.</span></div>';
    if (estrategiaCard) estrategiaCard.style.display = 'none';
    return;
  }

  lista.innerHTML = dividasCadastradas.map(d => {
    const badgeClass = 'badge-' + d.tipo;
    const label = DIVIDA_LABELS[d.tipo] || d.tipo;
    const icon = DIVIDA_ICONS[d.tipo] || '📋';
    const sub = d.juros > 0 ? `${d.juros}% a.m.` : (d.credor ? `Deve para: ${d.credor}` : label);
    const parcSub = d.parcelas > 0 ? ` · ${d.parcelas} parc. restantes` : '';
    return `<div class="divida-item">
      <div class="divida-item-icon">${icon}</div>
      <div class="divida-item-info">
        <div class="divida-item-nome">${d.descricao} <span class="divida-badge ${badgeClass}">${label}</span></div>
        <div class="divida-item-sub">${sub}${parcSub}</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
        <div class="divida-item-valor">${fmt(d.valor)}</div>
        <button class="divida-btn-del" onclick="excluirDivida(${d.id})">✕</button>
      </div>
    </div>`;
  }).join('');

  // Estratégia
  if (estrategiaCard) {
    estrategiaCard.style.display = 'block';
    gerarEstrategia();
  }
}

function atualizarKPIsDividas() {
  const total = dividasCadastradas.reduce((s, d) => s + d.valor, 0);
  const cartao = dividasCadastradas.filter(d => d.tipo === 'cartao').reduce((s, d) => s + d.valor, 0);
  const emprest = dividasCadastradas.filter(d => d.tipo === 'emprestimo' || d.tipo === 'financiamento').reduce((s, d) => s + d.valor, 0);
  const terceiros = dividasCadastradas.filter(d => d.tipo === 'terceiros').reduce((s, d) => s + d.valor, 0);

  const totalEl = document.getElementById('div-kpi-total');
  const qtdEl = document.getElementById('div-kpi-qtd');
  const cartaoEl = document.getElementById('div-kpi-cartao');
  const emprestEl = document.getElementById('div-kpi-emprest');
  const terceirosEl = document.getElementById('div-kpi-terceiros');

  if (totalEl) totalEl.textContent = fmt(total);
  if (qtdEl) qtdEl.textContent = dividasCadastradas.length > 0 ? dividasCadastradas.length + ' dívida(s) ativa(s)' : 'Nenhuma dívida cadastrada';
  if (cartaoEl) cartaoEl.textContent = fmt(cartao);
  if (emprestEl) emprestEl.textContent = fmt(emprest);
  if (terceirosEl) terceirosEl.textContent = fmt(terceiros);
}

function gerarEstrategia() {
  const textoEl = document.getElementById('estrategia-texto');
  if (!textoEl || dividasCadastradas.length === 0) return;

  const temAltoJuros = dividasCadastradas.some(d => d.juros >= 5);
  const total = dividasCadastradas.reduce((s, d) => s + d.valor, 0);

  let texto = '';
  if (temAltoJuros) {
    const maiorJuros = [...dividasCadastradas].sort((a,b) => b.juros - a.juros)[0];
    texto = `<strong>🔥 Método Avalanche recomendado</strong><br>Você tem dívidas com juros altos. Concentre pagamentos extras na <strong>${maiorJuros.descricao}</strong> (${maiorJuros.juros}% a.m.) primeiro — ela cresce mais rápido. Depois pague as demais em ordem de juros.`;
  } else if (dividasCadastradas.length > 2) {
    const menorValor = [...dividasCadastradas].sort((a,b) => a.valor - b.valor)[0];
    texto = `<strong>⛄ Método Bola de Neve recomendado</strong><br>Você tem várias dívidas de valores similares. Quite a <strong>${menorValor.descricao}</strong> (${fmt(menorValor.valor)}) primeiro para ganhar motivação. A sensação de "dívida zerada" ajuda a manter o foco!`;
  } else {
    texto = `<strong>📋 Plano de quitação</strong><br>Total de ${fmt(total)} em dívidas. Separe um percentual fixo da renda todo mês para quitação — mesmo que seja R$ 200, a consistência faz diferença. Evite novas dívidas enquanto quita as atuais.`;
  }
  textoEl.innerHTML = texto;
}

// Carregar dívidas do onboarding inicial
(function carregarDividasOnboarding() {
  const perfil = JSON.parse(localStorage.getItem('monvy_perfil_vida') || '{}');
  if (perfil.dividas && dividasCadastradas.length === 0) {
    const tipos = { cartao: 'Cartão de crédito (onboarding)', emprestimo: 'Empréstimo (onboarding)', terceiros: 'Dívida com terceiros (onboarding)', financiamento: 'Financiamento (onboarding)' };
    Object.entries(perfil.dividas).forEach(([tipo, valor]) => {
      if (valor > 0) {
        dividasCadastradas.push({ id: Date.now() + Math.random(), tipo, descricao: tipos[tipo] || tipo, valor, juros: 0, parcelas: 0, dataCriacao: new Date().toISOString().slice(0,10) });
      }
    });
    if (dividasCadastradas.length > 0) salvarDividas();
  }
})();

// ===== PERFIL DE VIDA (modal) =====
function abrirTabPerfil(tab) {
  ['conta','vida','financas'].forEach(t => {
    document.getElementById('perfil-tab-' + t).style.display = t === tab ? 'block' : 'none';
    const btn = document.getElementById('tab-' + t);
    if (btn) btn.classList.toggle('active', t === tab);
  });
  if (tab === 'vida') carregarEstadoVida();
  if (tab === 'financas') carregarEstadoFinancas();
}

function carregarEstadoVida() {
  const perfil = JSON.parse(localStorage.getItem('monvy_perfil_vida') || '{}');
  // Moradia
  document.querySelectorAll('#vida-moradia-opts .vida-opt').forEach(el => {
    const val = el.getAttribute('onclick')?.match(/'([^']+)'\)$/)?.[1];
    el.classList.toggle('selected', val === perfil.moradia);
  });
  // Transporte
  document.querySelectorAll('#vida-transporte-opts .vida-opt').forEach(el => {
    const val = el.getAttribute('onclick')?.match(/'([^']+)'\)$/)?.[1];
    el.classList.toggle('selected', (perfil.transporte || []).includes(val));
  });
  // Filhos
  const filhosSim = document.getElementById('vida-filhos-sim');
  const filhosNao = document.getElementById('vida-filhos-nao');
  if (filhosSim) filhosSim.classList.toggle('selected', perfil.filhos === 'sim');
  if (filhosNao) filhosNao.classList.toggle('selected', perfil.filhos === 'nao');
}

function carregarEstadoFinancas() {
  const perfil = JSON.parse(localStorage.getItem('monvy_perfil_vida') || '{}');
  const rendaEl = document.getElementById('perfil-renda');
  if (rendaEl && perfil.renda) rendaEl.value = perfil.renda;
}

function selecionarVida(el, campo, valor) {
  const parent = el.closest('[id$="-opts"]') || el.parentElement;
  parent.querySelectorAll('.vida-opt:not(.multi)').forEach(o => {
    const v = o.getAttribute('onclick')?.match(/'([^']+)'\)$/)?.[1];
    if (v) o.classList.toggle('selected', v === valor);
  });
  // Salvar no estado temporário
  if (!window._perfilVidaTemp) window._perfilVidaTemp = JSON.parse(localStorage.getItem('monvy_perfil_vida') || '{}');
  window._perfilVidaTemp[campo] = valor;
}

function selecionarVidaMulti(el, campo, valor) {
  el.classList.toggle('selected');
  if (!window._perfilVidaTemp) window._perfilVidaTemp = JSON.parse(localStorage.getItem('monvy_perfil_vida') || '{}');
  if (!window._perfilVidaTemp[campo]) window._perfilVidaTemp[campo] = [];
  if (el.classList.contains('selected')) {
    if (!window._perfilVidaTemp[campo].includes(valor)) window._perfilVidaTemp[campo].push(valor);
  } else {
    window._perfilVidaTemp[campo] = window._perfilVidaTemp[campo].filter(v => v !== valor);
  }
}

function setMetaEco(el, pct) {
  document.querySelectorAll('#meta-eco-opts .vida-opt').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  if (!window._perfilVidaTemp) window._perfilVidaTemp = JSON.parse(localStorage.getItem('monvy_perfil_vida') || '{}');
  window._perfilVidaTemp.metaEconomia = pct;
}

function salvarPerfilVida() {
  const perfil = window._perfilVidaTemp || JSON.parse(localStorage.getItem('monvy_perfil_vida') || '{}');
  localStorage.setItem('monvy_perfil_vida', JSON.stringify(perfil));
  window._perfilVidaTemp = null;
  // Sincronizar com Firebase
  if (currentUser) {
    fbSalvarPerfilVida(currentUser.uid, perfil).catch(e => console.error('Erro ao salvar perfil de vida no Firebase:', e));
  }
  const suc = document.getElementById('vida-sucesso');
  if (suc) { suc.style.display = 'block'; setTimeout(() => suc.style.display = 'none', 2000); }
}

function salvarPerfilFinancas() {
  const perfil = JSON.parse(localStorage.getItem('monvy_perfil_vida') || '{}');
  const renda = parseFloat(document.getElementById('perfil-renda')?.value) || perfil.renda || 0;
  if (window._perfilVidaTemp?.metaEconomia !== undefined) perfil.metaEconomia = window._perfilVidaTemp.metaEconomia;
  perfil.renda = renda;
  localStorage.setItem('monvy_perfil_vida', JSON.stringify(perfil));
  // Sincronizar com Firebase
  if (currentUser) {
    fbSalvarPerfilVida(currentUser.uid, perfil).catch(e => console.error('Erro ao salvar finanças no Firebase:', e));
  }
  const suc = document.getElementById('financas-sucesso');
  if (suc) { suc.style.display = 'block'; setTimeout(() => suc.style.display = 'none', 2000); }
}

// Inicializar dívidas ao carregar
(function initDividas() {
  renderizarDividas();
  atualizarKPIsDividas();
  atualizarFormDivida();
})();

// Atualizar ao navegar para tela de dívidas
const _irParaOrig = irPara;
window.irPara = function(tela) {
  _irParaOrig(tela);
  if (tela === 'dividas') {
    renderizarDividas();
    atualizarKPIsDividas();
  }
};

// ==============================
// MÓDULO 2 — GASTOS ADAPTATIVOS
// ==============================

// Mapa completo de categorias com ícone, label, id e perfis que a ativam
const CATEGORIAS_CONFIG = [
  {
    id: 'cat-moradia',
    label: 'Moradia',         // aluguel
    labelAlt: 'Financiamento',// financiada
    icon: 'icone-aluguel.png',
    iconFn: (p) => p.moradia === 'financiada' ? 'icone-financiamento.png' : 'icone-aluguel.png',
    ativo: (p) => ['aluguel','financiada'].includes(p.moradia),
    labelFn: (p) => p.moradia === 'financiada' ? 'Financiamento' : 'Aluguel',
    cat: (p) => p.moradia === 'financiada' ? 'Financiamento' : 'Aluguel',
    metaPct: 0.30,   // sugestão: 30% da renda
    novo: false,
  },
  {
    id: 'cat-alimentacao',
    label: 'Alimentação',
    icon: 'icone-alimentacao-novo.png',
    ativo: () => true,       // sempre ativo
    cat: () => 'Alimentação',
    metaPct: 0.15,
    novo: false,
  },
  {
    id: 'cat-carro',
    label: 'Carro',
    icon: 'icone-carro-novo.png',
    ativo: (p) => (p.transporte || []).includes('carro'),
    cat: () => 'Carro',
    metaPct: 0.10,
    novo: false,
  },
  {
    id: 'cat-moto',
    label: 'Moto',
    icon: 'icone-moto-novo.png',
    ativo: (p) => (p.transporte || []).includes('moto'),
    cat: () => 'Moto',
    metaPct: 0.07,
    novo: false,
  },
  {
    id: 'cat-transporte',
    label: 'Transporte',
    icon: 'icone-onibus.png',
    iconFn: (p) => {
      const t = p.transporte || [];
      if (t.includes('app') && !t.includes('publico') && !t.includes('bike')) return 'icone-app.png';
      if (t.includes('bike')) return 'icone-bike.png';
      return 'icone-onibus.png';
    },
    ativo: (p) => {
      const t = p.transporte || [];
      return t.some(x => ['app','publico','bike'].includes(x));
    },
    cat: () => 'Transporte',
    metaPct: 0.05,
    novo: false,
  },
  {
    id: 'cat-educacao',
    label: 'Educação',
    icon: 'icone-bebe.png',
    ativo: (p) => p.filhos === 'sim',
    cat: () => 'Educação',
    metaPct: 0.08,
    novo: true,
  },
  {
    id: 'cat-saude',
    label: 'Saúde',
    icon: 'icone-saude-novo.png',
    ativo: () => true,
    cat: () => 'Saúde',
    metaPct: 0.08,
    novo: false,
  },
  {
    id: 'cat-pets',
    label: 'Pets',
    icon: 'icone-pets.png',
    ativo: (p) => (p.familia || []).includes('pets'),
    cat: () => 'Pets',
    metaPct: 0.05,
    novo: true,
  },
  {
    id: 'cat-lazer',
    label: 'Lazer',
    icon: 'icone-lazer.png',
    ativo: () => true,
    cat: () => 'Lazer',
    metaPct: 0.10,
    novo: false,
  },
  {
    id: 'cat-outros',
    label: 'Outros',
    icon: 'icone-outros.png',
    ativo: () => true,
    cat: () => 'Outros',
    metaPct: 0.05,
    novo: false,
  },
];

function obterPerfilVida() {
  return JSON.parse(localStorage.getItem('monvy_perfil_vida') || '{}');
}

function obterCategoriasAtivas() {
  const p = obterPerfilVida();
  return CATEGORIAS_CONFIG.filter(c => c.ativo(p));
}

function obterTodasCategorias() {
  // Retorna lista de strings para usar nos selects
  const p = obterPerfilVida();
  return CATEGORIAS_CONFIG
    .filter(c => c.ativo(p))
    .map(c => c.labelFn ? c.labelFn(p) : c.label);
}

function sincronizarSelects() {
  // Atualiza os <select> de categoria nos modais conforme perfil
  const cats = obterTodasCategorias();
  ['modal-categoria','edit-categoria'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const atual = sel.value;
    sel.innerHTML = cats.map(c =>
      `<option value="${c}"${c === atual ? ' selected' : ''}>${c}</option>`
    ).join('');
  });
}

function renderizarGridCategorias() {
  const grid = document.getElementById('categorias-grid-dinamico');
  if (!grid) return;

  const p = obterPerfilVida();
  const lista = obterCategoriasAtivas();
  const movs = movsFiltradas();

  // Calcular totais por categoria
  const totais = {};
  movs.filter(m => m.tipo === 'gasto').forEach(m => {
    totais[m.categoria] = (totais[m.categoria] || 0) + m.valor;
  });

  const renda = p.renda || 0;

  grid.innerHTML = lista.map(c => {
    const catNome = c.labelFn ? c.labelFn(p) : c.label;
    const icon = c.iconFn ? c.iconFn(p) : c.icon;
    const gasto = totais[catNome] || 0;
    const meta = renda > 0 ? renda * c.metaPct : 0;
    const pct = meta > 0 ? Math.min(100, Math.round((gasto / meta) * 100)) : 0;
    const warnClass = pct >= 100 ? 'danger' : pct >= 75 ? 'warn' : '';
    const idEl = c.id;
    const isNovo = c.novo && p && Object.keys(p).length > 0;

    let metaHtml = '';
    if (meta > 0) {
      metaHtml = `
        <div class="cat-meta-bar">
          <div class="cat-meta-fill ${warnClass}" style="width:${pct}%"></div>
        </div>
        <div class="cat-meta-label ${warnClass}" style="margin-top:5px">${pct}% do limite</div>`;
    }

    return `<div class="cat-card${isNovo ? ' cat-novo' : ''}" style="position:relative;padding-bottom:${meta > 0 ? '18px' : ''}">
      <div class="cat-icon"><img src="${icon}" alt="${catNome}" style="width:56px;height:56px;object-fit:contain;"></div>
      <div class="cat-nome">${catNome}</div>
      <div class="cat-valor" id="${idEl}">${fmt(gasto)}</div>
      ${metaHtml}
    </div>`;
  }).join('');
}

function atualizarBannerPerfil() {
  const banner = document.getElementById('gastos-perfil-banner');
  const desc = document.getElementById('gastos-perfil-desc');
  if (!banner || !desc) return;

  const p = obterPerfilVida();
  if (!p || Object.keys(p).length === 0) {
    banner.style.display = 'none';
    return;
  }

  banner.style.display = 'flex';
  const partes = [];
  if (p.moradia === 'aluguel') partes.push('aluguel');
  else if (p.moradia === 'financiada') partes.push('financiamento');
  else if (p.moradia === 'propria') partes.push('casa própria');
  const t = p.transporte || [];
  if (t.includes('carro') && t.includes('moto')) partes.push('carro + moto');
  else if (t.includes('carro')) partes.push('carro');
  else if (t.includes('moto')) partes.push('moto');
  if (p.filhos === 'sim') partes.push('filhos');
  if ((p.familia || []).includes('pets')) partes.push('pets');
  desc.textContent = partes.length > 0 ? partes.join(' · ') : 'Perfil configurado';
}

function renderizarSugestaoOrcamento() {
  const el = document.getElementById('sugestao-orcamento');
  if (!el) return;
  const p = obterPerfilVida();
  const renda = p.renda || 0;
  if (renda <= 0) { el.style.display = 'none'; return; }

  const necessidades = Math.round(renda * 0.50);
  const desejos = Math.round(renda * 0.30);
  const futuro = Math.round(renda * 0.20);

  // Calcular o que já foi gasto este mês
  const agora = new Date();
  const gastosMes = movimentacoes
    .filter(m => m.tipo === 'gasto' && m.data && new Date(m.data + 'T00:00:00').getMonth() === agora.getMonth() && new Date(m.data + 'T00:00:00').getFullYear() === agora.getFullYear())
    .reduce((s, m) => s + m.valor, 0);

  const pctGasto = Math.min(100, Math.round((gastosMes / (renda * 0.80)) * 100));
  const fillClass = pctGasto >= 100 ? 'danger' : pctGasto >= 75 ? 'warn' : '';

  el.style.display = 'block';
  el.innerHTML = `<div class="orcamento-sugestao">
    <div class="orcamento-sugestao-titulo">
      <span><img src="icone-grafico-novo.png" style="width:28px;height:28px;object-fit:contain;vertical-align:middle"></span>
      Sugestão 50·30·20 — baseada na sua renda de ${fmt(renda)}/mês
      <div style="margin-left:auto;font-size:.72rem;color:var(--gray);font-weight:400">Gastos este mês: <strong style="color:${pctGasto>=100?'#ef4444':pctGasto>=75?'#f59e0b':'var(--primary)'}">${fmt(gastosMes)}</strong></div>
    </div>
    <div class="orcamento-regras">
      <div class="orcamento-regra">
        <div class="orcamento-regra-pct or-verde">50%</div>
        <div class="orcamento-regra-label">Necessidades<br>moradia, alimentação...</div>
        <div class="orcamento-regra-val or-verde">${fmt(necessidades)}</div>
      </div>
      <div class="orcamento-regra">
        <div class="orcamento-regra-pct or-azul">30%</div>
        <div class="orcamento-regra-label">Desejos<br>lazer, roupas...</div>
        <div class="orcamento-regra-val or-azul">${fmt(desejos)}</div>
      </div>
      <div class="orcamento-regra">
        <div class="orcamento-regra-pct or-amarelo">20%</div>
        <div class="orcamento-regra-label">Futuro<br>reserva, investimento</div>
        <div class="orcamento-regra-val or-amarelo">${fmt(futuro)}</div>
      </div>
    </div>
    <div style="margin-top:12px">
      <div style="display:flex;justify-content:space-between;font-size:.72rem;color:var(--gray);margin-bottom:4px">
        <span>Progresso de gastos este mês</span>
        <span>${pctGasto}% do orçamento</span>
      </div>
      <div style="height:6px;background:rgba(255,255,255,0.06);border-radius:6px;overflow:hidden">
        <div style="height:100%;width:${pctGasto}%;border-radius:6px;background:${pctGasto>=100?'#ef4444':pctGasto>=75?'#f59e0b':'#22c55e'};transition:width .5s ease"></div>
      </div>
    </div>
  </div>`;
}

// Sobrescreve atualizarTelaCategorias para versão adaptativa
function atualizarTelaCategorias() {
  renderizarGridCategorias();
  atualizarBannerPerfil();
  renderizarSugestaoOrcamento();
  sincronizarSelects();

  // Recalcular totais para o gráfico pizza (usando categorias ativas)
  const lista = movsFiltradas();
  const p = obterPerfilVida();
  const cats = {};
  obterCategoriasAtivas().forEach(c => {
    const nome = c.labelFn ? c.labelFn(p) : c.label;
    cats[nome] = 0;
  });
  lista.filter(m => m.tipo === 'gasto').forEach(m => {
    if (cats[m.categoria] !== undefined) cats[m.categoria] += m.valor;
    else cats['Outros'] = (cats['Outros'] || 0) + m.valor;
  });
  atualizarChartPizza(cats);

  // Tabela
  const tbody = document.getElementById('tabela-gastos');
  const count = document.getElementById('table-count');
  count.textContent = lista.length + ' registros';
  if (lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="vazio">Nenhuma movimentação no período.</td></tr>';
    return;
  }
  tbody.innerHTML = [...lista].sort((a,b) => (b.data||'').localeCompare(a.data||'')).map(m => {
    const idx = movimentacoes.indexOf(m);
    return `<tr>
      <td>${m.descricao}${m.recorrente ? ' <span style="font-size:.7rem;background:rgba(57,255,121,0.15);color:var(--primary);padding:1px 6px;border-radius:4px">recorrente</span>' : ''}</td>
      <td style="color:var(--gray);font-size:.82rem">${m.data ? fmtData(m.data) : '—'}</td>
      <td>${m.tipo === 'ganho' ? '—' : m.categoria}</td>
      <td><span class="badge ${m.tipo}">${m.tipo === 'ganho' ? '↑ Entrada' : '↓ Saída'}</span></td>
      <td class="mov-valor ${m.tipo === 'ganho' ? 'positivo' : 'negativo'}">${m.tipo === 'ganho' ? '+' : '-'}${fmt(m.valor)}</td>
      <td><button onclick="abrirModalEditar(${idx})" style="background:none;border:none;cursor:pointer;color:var(--gray);padding:4px;border-radius:6px" title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button></td>
    </tr>`;
  }).join('');
}

// Módulo 4: quando salvarPerfilVida() é chamado, recalibrar gastos automaticamente
const _salvarPerfilVidaOrig = salvarPerfilVida;
window.salvarPerfilVida = function() {
  _salvarPerfilVidaOrig();
  // Recalibrar tudo
  setTimeout(() => {
    atualizarTelaCategorias();
    atualizarBannerPerfil();
    sincronizarSelects();
  }, 100);
};

// Inicializar selects ao carregar (garante sincronia mesmo sem entrar na tela)
window.addEventListener('load', () => {
  sincronizarSelects();
  renderizarGridCategorias();
  atualizarBannerPerfil();
});

// ==============================
// EXPOR FUNÇÕES GLOBALMENTE
// Necessário porque script.js usa type="module"
// e funções de módulo não ficam no escopo window
// ==============================
window.irPara           = window.irPara || irPara;
window.abrirModal       = abrirModal;
window.fecharModal      = fecharModal;
window.confirmarModal   = confirmarModal;
window.responderPergunta = responderPergunta;
window.abrirModalEditar = abrirModalEditar;
window.fecharModalEditar = fecharModalEditar;
window.salvarEdicao     = salvarEdicao;
window.excluirMovimentacao = excluirMovimentacao;
window.setFiltro        = setFiltro;
window.setTipoGrafico   = setTipoGrafico;
window.criarMeta        = criarMeta;
window.abrirModalMeta   = abrirModalMeta;
window.fecharModalMeta  = fecharModalMeta;
window.adicionarValorMeta = adicionarValorMeta;
window.calcularDivida   = calcularDivida;
window.calcularInvestimentos = calcularInvestimentos;
window.abrirArtigo      = abrirArtigo;
window.fecharArtigo     = fecharArtigo;
window.logout           = logout;
window.toggleTheme      = toggleTheme;
window.applyTheme       = applyTheme;
window.mudarMesRelatorio = mudarMesRelatorio;
window.setPeriodoModo   = setPeriodoModo;
window.aplicarPeriodoCustom = aplicarPeriodoCustom;
window.atalhoUltimos    = atalhoUltimos;
window.processarRecorrentes = processarRecorrentes;
window.buscarMovimentacoes = buscarMovimentacoes;
window.limparBusca      = limparBusca;
window.abrirBuscaMobile = abrirBuscaMobile;
window.fecharBuscaMobile = fecharBuscaMobile;
window.fecharDropdownBusca = fecharDropdownBusca;
window.mostrarDropdownBusca = mostrarDropdownBusca;
window.atualizarFormDivida  = atualizarFormDivida;
window.cadastrarDivida      = cadastrarDivida;
window.excluirDivida        = excluirDivida;
window.abrirTabPerfil       = abrirTabPerfil;
window.selecionarVida       = selecionarVida;
window.selecionarVidaMulti  = selecionarVidaMulti;
window.setMetaEco           = setMetaEco;
window.salvarPerfilVida     = window.salvarPerfilVida || salvarPerfilVida;
window.salvarPerfilFinancas = salvarPerfilFinancas;
