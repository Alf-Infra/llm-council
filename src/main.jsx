import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import { Download, Menu, PanelRightOpen, PauseCircle, Play, Plus, Trash2, X } from 'lucide-react';
import './styles.css';

const statusText = {
  running: 'läuft',
  success: 'fertig',
  failed: 'Fehler',
  completed: 'abgeschlossen',
  chairman_failed: 'Chairman-Fehler',
  aborted: 'abgebrochen'
};

let modelSequence = 0;
const makeModel = (value) => ({ id: `model-${++modelSequence}`, value });

function App() {
  const [config, setConfig] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [question, setQuestion] = useState('');
  const [providerBaseUrl, setProviderBaseUrl] = useState('https://openrouter.ai/api/v1');
  const [providerApiKey, setProviderApiKey] = useState('');
  const [providerStatus, setProviderStatus] = useState('');
  const [models, setModels] = useState([]);
  const [selectedCouncil, setSelectedCouncil] = useState([]);
  const [chairmanModel, setChairmanModel] = useState('');
  const [criteria, setCriteria] = useState([]);
  const [events, setEvents] = useState([]);
  const [currentRunId, setCurrentRunId] = useState(null);
  const [error, setError] = useState('');
  const [bootError, setBootError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(true);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const historyTriggerRef = useRef(null);
  const configTriggerRef = useRef(null);
  const historyDrawerRef = useRef(null);
  const configDrawerRef = useRef(null);
  const historyCloseRef = useRef(null);
  const configCloseRef = useRef(null);
  const abortRef = useRef(null);
  const running = Boolean(abortRef.current);

  async function loadInitial() {
    setBootError('');
    try {
      const responses = await Promise.all([fetch('/api/config'), fetch('/api/conversations')]);
      if (responses.some((response) => !response.ok)) throw new Error('Konfiguration oder Historie konnte nicht geladen werden.');
      const [cfg, list] = await Promise.all(responses.map((response) => response.json()));
      const initialModels = cfg.defaults.map(makeModel);
      setConfig(cfg);
      setProviderBaseUrl(cfg.openRouterDefaultBaseUrl || 'https://openrouter.ai/api/v1');
      setModels(initialModels);
      setSelectedCouncil(initialModels.slice(0, 2).map((item) => item.id));
      setChairmanModel(initialModels[2]?.id || initialModels[0]?.id || '');
      setCriteria(cfg.criteria.map((item) => ({ ...item, enabled: true, weight: item.defaultWeight })));
      setConversations(list.conversations || []);
    } catch (err) {
      setBootError(err.message || 'Die App konnte nicht geladen werden.');
    }
  }

  useEffect(() => {
    loadInitial();
  }, []);

  const historyModalOpen = historyOpen && viewportWidth <= 760;
  const configModalOpen = configOpen && viewportWidth <= 1100;
  const modalOpen = historyModalOpen || configModalOpen;

  useEffect(() => {
    if (!modalOpen) return undefined;
    const drawer = historyModalOpen ? historyDrawerRef.current : configDrawerRef.current;
    const initialFocus = historyModalOpen ? historyCloseRef.current : configCloseRef.current;
    requestAnimationFrame(() => initialFocus?.focus());
    const handleKeys = (event) => {
      if (event.key === 'Escape') {
        closeDrawer(historyModalOpen ? 'history' : 'config');
        return;
      }
      if (event.key !== 'Tab' || !drawer) return;
      const focusable = [...drawer.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href], summary')].filter((node) => node.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKeys);
    return () => document.removeEventListener('keydown', handleKeys);
  }, [modalOpen, historyModalOpen]);

  useEffect(() => {
    const updateWidth = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const adapt = (event) => {
      if (event.matches) {
        setHistoryOpen(false);
        setConfigOpen(false);
      }
    };
    adapt(media);
    media.addEventListener('change', adapt);
    return () => media.removeEventListener('change', adapt);
  }, []);

  const state = useMemo(() => deriveRunState(events), [events]);

  async function refreshConversations() {
    const list = await fetch('/api/conversations').then((r) => r.json());
    setConversations(list.conversations || []);
  }

  async function openConversation(id) {
    try {
      const response = await fetch(`/api/conversations/${id}`);
      if (!response.ok) throw new Error('Conversation konnte nicht geöffnet werden.');
      const data = await response.json();
      const runs = data.conversation.runs || [];
      const latest = runs.reduce((newest, run) => !newest || String(run.started_at || '') > String(newest.started_at || '') ? run : newest, null);
      setSelectedConversation(id);
      setCurrentRunId(latest?.id || null);
      setEvents(latest ? historyToEvents(latest) : []);
      setHistoryOpen(false);
      setConfigOpen(false);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }

  function newConversation() {
    abortRef.current?.abort();
    abortRef.current = null;
    setSelectedConversation(null);
    setCurrentRunId(null);
    setEvents([]);
    setQuestion('');
    setError('');
    setProviderStatus('');
    setHistoryOpen(false);
    setConfigOpen(true);
  }

  function openDrawer(kind, trigger) {
    if (kind === 'history') {
      historyTriggerRef.current = trigger;
      setHistoryOpen(true);
    } else {
      configTriggerRef.current = trigger;
      setConfigOpen(true);
    }
  }

  function closeDrawer(kind) {
    if (kind === 'history') {
      const trigger = historyTriggerRef.current;
      setHistoryOpen(false);
      requestAnimationFrame(() => trigger?.focus());
    } else {
      const trigger = configTriggerRef.current;
      setConfigOpen(false);
      requestAnimationFrame(() => trigger?.focus());
    }
  }

  function addModel() {
    setModels([...models, makeModel(`model-${models.length + 1}`)]);
  }

  function updateModel(id, value) {
    setModels(models.map((model) => model.id === id ? { ...model, value } : model));
  }

  function removeModel(id) {
    setModels(models.filter((model) => model.id !== id));
    setSelectedCouncil(selectedCouncil.filter((modelId) => modelId !== id));
    if (chairmanModel === id) setChairmanModel('');
  }

  function toggleCouncil(id) {
    setSelectedCouncil(selectedCouncil.includes(id) ? selectedCouncil.filter((modelId) => modelId !== id) : [...selectedCouncil, id]);
  }

  function modelRef(model) {
    return {
      provider: {
        id: 'openrouter',
        type: 'openrouter',
        label: 'OpenRouter',
        baseUrl: providerBaseUrl.trim(),
        apiKey: providerApiKey
      },
      model: model.trim()
    };
  }

  function validate() {
    const activeCriteria = criteria.filter((item) => item.enabled);
    const trimmedModels = models.map((m) => m.value.trim()).filter(Boolean);
    const problems = [];
    if (!question.trim()) problems.push('Bitte eine Frage eingeben.');
    if (!providerBaseUrl.trim()) problems.push('Bitte eine OpenRouter Base URL angeben.');
    if (selectedCouncil.length < 2) problems.push('Bitte mindestens zwei Council-Modelle wählen.');
    if (!chairmanModel) problems.push('Bitte genau ein Chairman-Modell wählen.');
    if (new Set(selectedCouncil).size !== selectedCouncil.length || new Set(trimmedModels).size !== trimmedModels.length) problems.push('Modellkennungen dürfen nicht doppelt vorkommen.');
    if (selectedCouncil.includes(chairmanModel)) problems.push('Chairman-Modell muss getrennt von den Council-Modellen sein.');
    if (!activeCriteria.length) problems.push('Bitte mindestens ein Kriterium aktivieren.');
    return problems;
  }

  async function testProvider() {
    const model = models.find((item) => item.id === selectedCouncil[0]) || models[0];
    if (!model || !providerBaseUrl.trim()) {
      setProviderStatus('Bitte Base URL und mindestens ein Modell angeben.');
      return;
    }
    setProviderStatus('Teste OpenRouter...');
    try {
      const response = await fetch('/api/provider/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      body: JSON.stringify(modelRef(model.value))
      });
      const body = await response.json();
      setProviderStatus(body.ok ? `Verbindung ok (${body.latencyMs ?? '-'} ms).` : body.error || 'Provider-Test fehlgeschlagen.');
    } catch (err) {
      setProviderStatus(err.message || 'Provider-Test fehlgeschlagen.');
    }
  }

  async function startRun() {
    const problems = validate();
    if (problems.length) {
      setError(problems.join(' '));
      return;
    }
    setError('');
    setEvents([]);
    setConfigOpen(false);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question,
          conversationId: selectedConversation,
          councilModels: selectedCouncil.map((id) => modelRef(models.find((item) => item.id === id)?.value || '')),
          chairmanModel: modelRef(models.find((item) => item.id === chairmanModel)?.value || ''),
          criteria: criteria.filter((item) => item.enabled).map(({ id, weight }) => ({ id, weight }))
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error((body.errors || [body.error]).join(' '));
      }
      await readSse(response.body, (event) => {
        if (event.runId) setCurrentRunId(event.runId);
        if (event.conversationId) setSelectedConversation(event.conversationId);
        setEvents((prev) => [...prev, event]);
      });
      await refreshConversations();
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message || 'Der Lauf ist fehlgeschlagen.');
    } finally {
      abortRef.current = null;
    }
  }

  async function cancelRun() {
    abortRef.current?.abort();
    if (currentRunId) await fetch(`/api/runs/${currentRunId}/cancel`, { method: 'POST' });
    setEvents((prev) => [...prev, { type: 'aborted', error: 'Der Lauf wurde abgebrochen.' }]);
    abortRef.current = null;
    await refreshConversations();
  }

  if (!config) return <main className="boot" id="main-content"><h1>LLM Council</h1>{bootError ? <><div className="error" role="alert">{bootError}</div><button onClick={loadInitial}>Erneut versuchen</button></> : <p role="status">App wird geladen…</p>}</main>;

  return (
    <><a className="skipLink" href="#main-content" inert={modalOpen ? '' : undefined}>Zum Hauptinhalt springen</a><div className={`shell ${configOpen ? '' : 'configCollapsed'}`}>
      <header className="mobileBar" inert={modalOpen ? '' : undefined}>
        <button className="icon" aria-label="Historie öffnen" aria-expanded={historyOpen} onClick={(event) => openDrawer('history', event.currentTarget)}><Menu aria-hidden="true" /></button>
        <strong>LLM Council</strong>
        <button data-testid="mobile-config-trigger" className="icon" aria-label="Konfiguration öffnen" aria-expanded={configOpen} onClick={(event) => openDrawer('config', event.currentTarget)}><PanelRightOpen aria-hidden="true" /></button>
      </header>
      {modalOpen && <div className="drawerBackdrop" aria-hidden="true" onClick={() => closeDrawer(historyModalOpen ? 'history' : 'config')} />}
      <aside ref={historyDrawerRef} className={`sidebar ${historyOpen ? 'drawerOpen' : ''}`} aria-label="Conversation-Historie" role={historyModalOpen ? 'dialog' : undefined} aria-modal={historyModalOpen ? 'true' : undefined} inert={(viewportWidth <= 760 && !historyOpen) || configModalOpen ? '' : undefined}>
        <div className="asideHeading"><div className="brand" aria-hidden="true">LLM Council</div><button ref={historyCloseRef} className="icon drawerClose" aria-label="Historie schließen" onClick={() => closeDrawer('history')}><X aria-hidden="true" /></button></div>
        <button className="new" onClick={newConversation}>Neue Conversation</button>
        <div className="history">
          {conversations.map((item) => (
            <div className={item.id === selectedConversation ? 'historyItem active' : 'historyItem'} key={item.id}>
              <button className="historyContent" onClick={() => openConversation(item.id)} aria-current={item.id === selectedConversation ? 'page' : undefined}>
                <span>{item.title}</span>
                <small>{statusText[item.latest_status] || item.latest_status || 'bereit'}</small>
              </button>
              <button className="icon deleteConv" onClick={() => { if (confirm('Conversation endgültig löschen?')) { fetch(`/api/conversations/${item.id}`, { method: 'DELETE' }).then(() => { if (selectedConversation === item.id) newConversation(); refreshConversations(); }); } }} aria-label={`Conversation „${item.title}“ löschen`}><Trash2 size={14} aria-hidden="true" /></button>
            </div>
          ))}
        </div>
      </aside>

      <main className="workspace" id="main-content" inert={modalOpen ? '' : undefined}>
        <div className="workspaceHeading"><div><p className="eyebrow">Council Analysis Workspace</p><h1>LLM Council Analyse</h1></div><button className="configToggle" aria-expanded={configOpen} onClick={(event) => { configTriggerRef.current = event.currentTarget; setConfigOpen(!configOpen); }}><PanelRightOpen size={17} aria-hidden="true" /> {configOpen ? 'Konfiguration schließen' : 'Konfiguration öffnen'}</button></div>
        <section className="composer">
          <label htmlFor="question">Frage an das Council</label>
          <textarea id="question" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Was soll das Council analysieren?" />
          <div className="actions">
            <button className="primary" disabled={running} onClick={startRun}><Play size={16} /> Lauf starten</button>
            <button disabled={!running} onClick={cancelRun}><PauseCircle size={16} /> Abbrechen</button>
            {currentRunId && <a className="linkButton" href={`/api/runs/${currentRunId}/export.md`}><Download size={16} /> Export</a>}
          </div>
          {error && <div className="error" role="alert">{error}</div>}
        </section>

        <RunView state={state} runId={currentRunId} />
      </main>

      <aside ref={configDrawerRef} className={`configRail ${configOpen ? 'drawerOpen' : ''}`} aria-label="Laufkonfiguration" role={configModalOpen ? 'dialog' : undefined} aria-modal={configModalOpen ? 'true' : undefined} inert={(viewportWidth <= 1100 && !configOpen) || historyModalOpen ? '' : undefined}>
        <div className="asideHeading"><div><p className="eyebrow">Einstellungen</p><h2>Konfiguration</h2></div><button ref={configCloseRef} className="icon drawerClose" aria-label="Konfiguration schließen" onClick={() => closeDrawer('config')}><X aria-hidden="true" /></button></div>
        <section className="configStack">
          <div className="configSection">
            <div className="panelHeader"><h2>OpenRouter</h2><button className="icon" onClick={addModel} title="Modell hinzufügen"><Plus size={16} /></button></div>
            <div className="providerGrid">
              <label>Base URL<input value={providerBaseUrl} onChange={(e) => setProviderBaseUrl(e.target.value)} /></label>
              <label>API-Key<input type="password" value={providerApiKey} onChange={(e) => setProviderApiKey(e.target.value)} autoComplete="off" placeholder="sk-or-..." /></label>
              <button onClick={testProvider}>Provider testen</button>
            </div>
            {providerStatus && <div className="providerStatus" role="status" aria-live="polite">{providerStatus}</div>}
            <fieldset className="modelList"><legend>Modelle und Rollen</legend>
              {models.map((model, index) => (
                <div className="modelRow" key={model.id}>
                  <label className="srOnly" htmlFor={`model-${model.id}`}>Modellkennung {index + 1}</label>
                  <input id={`model-${model.id}`} value={model.value} onChange={(e) => updateModel(model.id, e.target.value)} />
                  <label><input type="checkbox" checked={selectedCouncil.includes(model.id)} onChange={() => toggleCouncil(model.id)} /> Council</label>
                  <label><input type="radio" name="chairman" checked={chairmanModel === model.id} onChange={() => setChairmanModel(model.id)} /> Chairman</label>
                  <button className="icon" onClick={() => removeModel(model.id)} aria-label={`Modell ${index + 1} entfernen`}><Trash2 size={16} aria-hidden="true" /></button>
                </div>
              ))}
            </fieldset>
          </div>

          <div className="configSection">
            <h2>Kriterien</h2>
            <fieldset className="criteria"><legend>Bewertungskriterien und Gewichtung</legend>{criteria.map((item) => (
              <div className="criterion" key={item.id}>
                <label><input type="checkbox" checked={item.enabled} onChange={(e) => setCriteria(criteria.map((c) => c.id === item.id ? { ...c, enabled: e.target.checked } : c))} /> {item.label}</label>
                <label className="srOnly" htmlFor={`weight-${item.id}`}>Gewichtung für {item.label}</label><input id={`weight-${item.id}`} type="range" min="0.5" max="3" step="0.5" value={item.weight} onChange={(e) => setCriteria(criteria.map((c) => c.id === item.id ? { ...c, weight: Number(e.target.value) } : c))} />
                <span>{item.weight}</span>
              </div>
            ))}</fieldset>
          </div>
        </section>
      </aside>
    </div></>
  );
}

const phaseLabels = { answers: '1 Antworten', reviews: '2 Peer-Review', improvement: '3 Verbesserung', re_review: '4 Re-Review', synthesis: '5 Synthese' };
const phases = ['answers', 'reviews', 'improvement', 're_review', 'synthesis'];

function RunView({ state }) {
  const [activeTab, setActiveTab] = useState('synthesis');
  const [selectedAnswers, setSelectedAnswers] = useState([]);
  const tabRefs = useRef([]);
  const currentIndex = phases.indexOf(state.stage);
  const completed = Boolean(state.finalAnswer || state.summary);
  const hasArtifacts = state.responses.length || state.reviews.length || state.ranking.length || completed;
  const responseProgress = state.responses.length
    ? `${state.responses.filter((item) => ['success', 'failed'].includes(item.status)).length} von ${state.responses.length} Council-Antworten abgeschlossen.`
    : 'Council-Antworten noch nicht gestartet.';
  useEffect(() => {
    if (completed) setActiveTab('synthesis');
  }, [completed]);

  const tabs = [
    { id: 'synthesis', label: 'Synthese' },
    { id: 'answers', label: 'Antworten' },
    { id: 'reviews', label: 'Bewertungen' },
    { id: 'run-data', label: 'Laufdaten' }
  ];
  function onTabKeyDown(event, index) {
    let next = null;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next !== null) {
      event.preventDefault();
      setActiveTab(tabs[next].id);
      tabRefs.current[next]?.focus();
    }
  }
  function toggleAnswer(id) {
    setSelectedAnswers((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 2 ? [...current, id] : [current[1], id]);
  }
  const comparison = state.responses.filter((item) => selectedAnswers.includes(item.anonymousId || item.model));
  return (
    <section className="run">
      <h2 className="srOnly">Fortschritt und Ergebnisse</h2>
      <p className="srOnly" role="status" aria-live="polite" aria-atomic="true" data-testid="phase-live-status">
        Aktuelle Phase: {phaseLabels[state.stage] || state.stage}.
      </p>
      <p className="srOnly" role="status" aria-live="polite" aria-atomic="true" data-testid="council-live-status">
        {responseProgress}
      </p>
      <ol className="phaseStrip" aria-label="Laufphasen">
        {phases.map((phase, index) => <li className={`${state.stage === phase ? 'phase active' : 'phase'}${index < currentIndex ? ' complete' : ''}`} aria-current={state.stage === phase ? 'step' : undefined} key={phase}><span className="srOnly">{index < currentIndex ? 'Abgeschlossen: ' : state.stage === phase ? 'Aktuell: ' : 'Ausstehend: '}</span>{phaseLabels[phase]}</li>)}
      </ol>
      {completed && <p className="srOnly" role="status" aria-live="polite" aria-atomic="true" data-testid="run-complete-status">Council-Lauf abgeschlossen. Die finale Phase ist Synthese.</p>}
      {!hasArtifacts ? <div className="emptyWorkspace"><h2>Bereit für eine gemeinsame Analyse</h2><p>Konfiguriere mindestens zwei Council-Modelle und starte eine Frage. Antworten, Bewertungen und Synthese erscheinen kompakt in getrennten Ansichten.</p></div> : <>
        <div className="resultTabs" role="tablist" aria-label="Ergebnisansichten">
          {tabs.map((tab, index) => <button key={tab.id} ref={(node) => { tabRefs.current[index] = node; }} id={`tab-${tab.id}`} role="tab" aria-selected={activeTab === tab.id} aria-controls={`panel-${tab.id}`} tabIndex={activeTab === tab.id ? 0 : -1} onKeyDown={(event) => onTabKeyDown(event, index)} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}
        </div>
        <section id="panel-synthesis" role="tabpanel" aria-labelledby="tab-synthesis" hidden={activeTab !== 'synthesis'} className="resultPanel final">
          <p className="eyebrow">Chairman-Ergebnis</p><h2>Synthese</h2>
          {state.finalAnswer ? <SafeMarkdown>{state.finalAnswer}</SafeMarkdown> : state.error ? <div className="error" role="alert">{state.error}</div> : <p className="muted">Noch keine Synthese.</p>}
        </section>
        <section id="panel-answers" role="tabpanel" aria-labelledby="tab-answers" hidden={activeTab !== 'answers'} className="resultPanel">
          <div className="sectionHeading"><div><p className="eyebrow">Quellen</p><h2>Einzelantworten</h2></div><span>{selectedAnswers.length}/2 für Vergleich gewählt</span></div>
          <div className="answerPicker">{state.responses.map((item) => { const id = item.anonymousId || item.model; return <label key={id}><input type="checkbox" checked={selectedAnswers.includes(id)} onChange={() => toggleAnswer(id)} /> {id}</label>; })}</div>
          {comparison.length === 2 ? <div className="comparison" data-testid="answer-comparison">{comparison.map((item) => <ResponseCard item={item} key={item.anonymousId || item.model} />)}</div> : <div className="cards">{state.responses.map((item) => <ResponseCard item={item} key={item.anonymousId || item.model} />)}</div>}
        </section>
        <section id="panel-reviews" role="tabpanel" aria-labelledby="tab-reviews" hidden={activeTab !== 'reviews'} className="resultPanel">
          <p className="eyebrow">Peer-Review</p><h2>Bewertungen</h2>
          <div className="rankingGrid"><RankingTable ranking={state.ranking} caption="Rangliste der ersten Bewertungsrunde" />{state.reRanking.length > 0 && <RankingTable ranking={state.reRanking} caption="Rangliste der zweiten Bewertungsrunde" />}</div>
          <div className="reviewGrid">{state.reviews.map((item) => <ReviewCard item={item} key={item.reviewerModel || item.model} />)}{state.reReviews.map((item) => <ReviewCard item={item} key={`re-${item.reviewerModel || item.model}`} />)}</div>
        </section>
        <section id="panel-run-data" role="tabpanel" aria-labelledby="tab-run-data" hidden={activeTab !== 'run-data'} className="resultPanel">
          <p className="eyebrow">Metadaten</p><h2>Laufdaten</h2>{state.summary ? <Summary summary={state.summary} /> : <p className="muted">Noch keine Laufzusammenfassung verfügbar.</p>}
        </section>
      </>}
    </section>
  );
}

function ResponseCard({ item }) {
  const meta = [item.model, `${item.latencyMs ?? '-'} ms`, `${item.usage?.total_tokens ?? item.total_tokens ?? '-'} Tokens`].filter(Boolean).join(' · ');
  const label = item.anonymousId || item.model || 'Modellantwort';
  const status = statusText[item.status] || item.status || 'wartet';
  return <article className="card"><header><strong>{label}</strong><span role={item.status === 'failed' ? 'alert' : 'status'} aria-live={item.status === 'failed' ? 'assertive' : 'polite'} aria-atomic="true" aria-label={`${label}: ${status}`}>{status}</span></header><small>{meta}</small><SafeMarkdown>{item.content || item.error || ''}</SafeMarkdown></article>;
}

function SafeMarkdown({ children }) {
  return <div className="markdown"><ReactMarkdown components={{ h1: 'h3', h2: 'h3', h3: 'h3', h4: 'h3', h5: 'h3', h6: 'h3' }}>{children}</ReactMarkdown></div>;
}

function RankingTable({ ranking, caption }) {
  if (!ranking.length) return <p className="muted">Noch keine Rangliste verfügbar.</p>;
  return <div className="tableScroll"><table><caption>{caption}</caption><thead><tr><th scope="col">Rang</th><th scope="col">Antwort</th><th scope="col">Score</th><th scope="col">Stimmen</th></tr></thead><tbody>{ranking.map((item) => <tr key={item.responseId}><td>{item.rank}</td><td>{item.responseId}<small>{item.model}</small></td><td>{item.weightedScore}</td><td>{item.validVotes}</td></tr>)}</tbody></table></div>;
}

function ReviewCard({ item }) {
  const review = item.review;
  const label = item.reviewerModel || item.model || 'Review';
  const status = statusText[item.status] || item.status || 'wartet';
  const assessments = review?.responses || review?.assessments || review?.evaluations || [];
  return <article className="card reviewCard"><header><strong>{label}</strong><span role={item.status === 'failed' ? 'alert' : 'status'} aria-live={item.status === 'failed' ? 'assertive' : 'polite'} aria-atomic="true" aria-label={`${label}: ${status}`}>{status}</span></header>{review ? <>
    {Array.isArray(assessments) && assessments.map((assessment, index) => <section className="assessment" key={assessment.responseId || index}><h3>{assessment.responseId || `Antwort ${index + 1}`}</h3><ScoreList scores={assessment.scores || assessment.criteria} /><p>{assessment.reasoning || assessment.rationale || assessment.justification}</p>{assessment.strengths?.length > 0 && <details><summary>Stärken</summary><ul>{assessment.strengths.map((value) => <li key={value}>{value}</li>)}</ul></details>}{assessment.weaknesses?.length > 0 && <details><summary>Schwächen</summary><ul>{assessment.weaknesses.map((value) => <li key={value}>{value}</li>)}</ul></details>}</section>)}
    {(review.ranking || review.finalRanking) && <p><strong>Reihenfolge:</strong> {(review.ranking || review.finalRanking).join(' → ')}</p>}
    <details className="technical"><summary>Technische Details</summary><pre>{JSON.stringify(review, null, 2)}</pre></details>
  </> : item.error ? <p className="error" role="alert">{item.error}</p> : null}</article>;
}

function ScoreList({ scores }) {
  if (!scores) return null;
  const entries = Array.isArray(scores) ? scores.map((item) => [item.criterion || item.id, item.score]) : Object.entries(scores);
  return <dl className="scoreList">{entries.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}/10</dd></div>)}</dl>;
}

function Summary({ summary }) {
  return <dl className="summary"><div><dt>Dauer</dt><dd>{formatDuration(summary.durationMs)}</dd></div><div><dt>Modellaufrufe</dt><dd>{summary.modelCalls}</dd></div><div><dt>Erfolgreich</dt><dd>{summary.successfulCalls}</dd></div><div><dt>Fehler</dt><dd>{summary.failedCalls}</dd></div><div><dt>Tokens</dt><dd>{summary.tokenTotals?.total || 0}</dd></div></dl>;
}

function formatDuration(ms = 0) {
  if (ms < 1000) return `${ms} ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} Sek.`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} min`;
}

function deriveRunState(events) {
  const state = { stage: 'answers', responses: [], reviews: [], ranking: [], improvedResponses: [], reReviews: [], reRanking: [], finalAnswer: '', summary: null, error: '' };
  for (const event of events) {
    if (event.stage) state.stage = event.stage;
    if (event.type === 'model_status' && event.stage === 'answers') {
      const item = event.response || { model: event.model, status: event.status, error: event.error };
      upsert(state.responses, item, (x) => x.model === event.model);
    }
    if (event.type === 'answers_complete' && event.responses) state.responses = [
      ...event.responses.map((item) => ({ status: 'success', ...item })),
      ...state.responses.filter((item) => item.status === 'failed' && item.model)
    ];
    if (event.type === 'model_status' && event.stage === 'reviews' && event.review) upsert(state.reviews, { reviewerModel: event.model, status: event.status, review: event.review }, (x) => x.reviewerModel === event.model);
    if (event.type === 'model_status' && event.stage === 'reviews' && event.status === 'failed') upsert(state.reviews, { reviewerModel: event.model, status: 'failed', error: event.error }, (x) => x.reviewerModel === event.model);
    if (event.type === 'ranking') state.ranking = event.ranking;
    if (event.type === 'answers_revealed' && event.responses) {
      for (const response of event.responses) {
        const existing = state.responses.find((item) => item.anonymousId === response.anonymousId || item.model === response.model);
        if (existing) Object.assign(existing, response);
        else state.responses.push(response);
      }
    }
    // Improvement round events
    if (event.type === 'model_status' && event.stage === 'improvement') {
      const item = event.response || { model: event.model, status: event.status, error: event.error };
      upsert(state.improvedResponses, item, (x) => x.model === event.model);
    }
    if (event.type === 'improvements_complete' && event.responses) {
      if (event.responses.length) state.improvedResponses = [
        ...event.responses.map((item) => ({ status: 'success', ...item })),
        ...state.improvedResponses.filter((item) => item.status === 'failed' && item.model)
      ];
    }
    if (event.type === 'model_status' && event.stage === 're_review' && event.review) upsert(state.reReviews, { reviewerModel: event.model, status: event.status, review: event.review }, (x) => x.reviewerModel === event.model);
    if (event.type === 'model_status' && event.stage === 're_review' && event.status === 'failed') upsert(state.reReviews, { reviewerModel: event.model, status: 'failed', error: event.error }, (x) => x.reviewerModel === event.model);
    if (event.type === 're_ranking') state.reRanking = event.ranking;
    if (event.type === 'improvements_revealed' && event.responses) {
      for (const response of event.responses) {
        const existing = state.improvedResponses.find((item) => item.anonymousId === response.anonymousId || item.model === response.model);
        if (existing) Object.assign(existing, response);
        else state.improvedResponses.push(response);
      }
    }
    if (event.finalAnswer) state.finalAnswer = event.finalAnswer;
    if (event.summary) state.summary = event.summary;
    if (event.error) state.error = event.error;
  }
  return state;
}

function historyToEvents(run) {
  const terminalStage = run.final_answer || run.chairman_error || ['completed', 'chairman_failed'].includes(run.status) ? 'synthesis' : run.stage;
  const events = [{ type: 'stage', stage: terminalStage }];
  const r1Responses = (run.responses || []).filter((r) => !r.round || r.round === 1);
  const r2Responses = (run.responses || []).filter((r) => r.round === 2);
  const r1Reviews = (run.reviews || []).filter((r) => !r.round || r.round === 1);
  const r2Reviews = (run.reviews || []).filter((r) => r.round === 2);
  if (run.modelStatuses) {
    events.push(...run.modelStatuses.map((r) => ({ type: 'model_status', stage: 'answers', model: r.model, status: r.status, response: { model: r.model, status: r.status, latencyMs: r.latency_ms, usage: { total_tokens: r.total_tokens } }, error: r.error })));
  }
  events.push({ type: 'answers_complete', responses: r1Responses.map((r) => ({ anonymousId: r.anonymous_id, status: r.status, content: r.content, error: r.error, latencyMs: r.latency_ms, usage: { total_tokens: r.total_tokens }, model: r.model })) });
  if (r1Reviews.length) events.push(...r1Reviews.map((r) => ({ type: 'model_status', stage: 'reviews', model: r.reviewer_model, status: r.status, review: r.review, error: r.error })));
  if (run.ranking) events.push({ type: 'ranking', ranking: run.ranking });
  if (run.revealed_at) events.push({ type: 'answers_revealed', responses: r1Responses.map((r) => ({ model: r.model, anonymousId: r.anonymous_id, status: r.status, content: r.content, error: r.error, latencyMs: r.latency_ms, usage: { total_tokens: r.total_tokens } })) });
  if (r2Responses.length) {
    events.push({ type: 'improvements_complete', responses: r2Responses.map((r) => ({ anonymousId: r.anonymous_id, status: r.status, content: r.content, error: r.error, latencyMs: r.latency_ms, usage: { total_tokens: r.total_tokens }, model: r.model })) });
    if (r2Reviews.length) events.push(...r2Reviews.map((r) => ({ type: 'model_status', stage: 're_review', model: r.reviewer_model, status: r.status, review: r.review, error: r.error })));
    events.push({ type: 'improvements_revealed', responses: r2Responses.map((r) => ({ model: r.model, anonymousId: r.anonymous_id, status: r.status, content: r.content, error: r.error, latencyMs: r.latency_ms, usage: { total_tokens: r.total_tokens } })) });
  }
  if (run.final_answer) events.push({ type: 'final', finalAnswer: run.final_answer, summary: run.summary });
  if (run.chairman_error) events.push({ type: 'chairman_failed', error: run.chairman_error, summary: run.summary });
  events.push({ type: 'stage', stage: terminalStage });
  return events;
}

async function readSse(stream, onEvent) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() || '';
    for (const chunk of chunks) {
      const line = chunk.split('\n').find((item) => item.startsWith('data: '));
      if (line) onEvent(JSON.parse(line.slice(6)));
    }
  }
}

function upsert(list, item, match) {
  const index = list.findIndex(match);
  if (index >= 0) list[index] = item;
  else list.push(item);
}

createRoot(document.getElementById('root')).render(<App />);
