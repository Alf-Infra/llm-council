import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import { Download, PauseCircle, Play, Plus, Trash2 } from 'lucide-react';
import './styles.css';

const statusText = {
  running: 'läuft',
  success: 'fertig',
  failed: 'Fehler',
  completed: 'abgeschlossen',
  chairman_failed: 'Chairman-Fehler',
  aborted: 'abgebrochen'
};

function App() {
  const [config, setConfig] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [question, setQuestion] = useState('');
  const [providerBaseUrl, setProviderBaseUrl] = useState('https://openrouter.ai/api/v1');
  const [providerApiKey, setProviderApiKey] = useState('');
  const [providerStatus, setProviderStatus] = useState('');
  const [models, setModels] = useState(['gpt-5.5', 'gpt-5.4', 'claude-sonnet-4-6', 'gemini-3-pro-preview']);
  const [selectedCouncil, setSelectedCouncil] = useState(['gpt-5.5', 'gpt-5.4']);
  const [chairmanModel, setChairmanModel] = useState('claude-sonnet-4-6');
  const [criteria, setCriteria] = useState([]);
  const [events, setEvents] = useState([]);
  const [currentRunId, setCurrentRunId] = useState(null);
  const [error, setError] = useState('');
  const abortRef = useRef(null);
  const running = Boolean(abortRef.current);

  useEffect(() => {
    Promise.all([fetch('/api/config').then((r) => r.json()), fetch('/api/conversations').then((r) => r.json())]).then(([cfg, list]) => {
      setConfig(cfg);
      setProviderBaseUrl(cfg.openRouterDefaultBaseUrl || 'https://openrouter.ai/api/v1');
      setModels(cfg.defaults);
      setSelectedCouncil(cfg.defaults.slice(0, 2));
      setChairmanModel(cfg.defaults[2] || cfg.defaults[0]);
      setCriteria(cfg.criteria.map((item) => ({ ...item, enabled: true, weight: item.defaultWeight })));
      setConversations(list.conversations || []);
    });
  }, []);

  const state = useMemo(() => deriveRunState(events), [events]);

  async function refreshConversations() {
    const list = await fetch('/api/conversations').then((r) => r.json());
    setConversations(list.conversations || []);
  }

  async function openConversation(id) {
    setSelectedConversation(id);
    const data = await fetch(`/api/conversations/${id}`).then((r) => r.json());
    const latest = data.conversation.runs?.[0];
    if (latest) setEvents(historyToEvents(latest));
  }

  function addModel() {
    const next = `model-${models.length + 1}`;
    setModels([...models, next]);
  }

  function updateModel(index, value) {
    const next = [...models];
    const old = next[index];
    next[index] = value;
    setModels(next);
    setSelectedCouncil(selectedCouncil.map((m) => (m === old ? value : m)));
    if (chairmanModel === old) setChairmanModel(value);
  }

  function removeModel(model) {
    setModels(models.filter((m) => m !== model));
    setSelectedCouncil(selectedCouncil.filter((m) => m !== model));
    if (chairmanModel === model) setChairmanModel('');
  }

  function toggleCouncil(model) {
    setSelectedCouncil(selectedCouncil.includes(model) ? selectedCouncil.filter((m) => m !== model) : [...selectedCouncil, model]);
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
    const trimmedModels = models.map((m) => m.trim()).filter(Boolean);
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
    const model = selectedCouncil[0] || models.find(Boolean);
    if (!model || !providerBaseUrl.trim()) {
      setProviderStatus('Bitte Base URL und mindestens ein Modell angeben.');
      return;
    }
    setProviderStatus('Teste OpenRouter...');
    try {
      const response = await fetch('/api/provider/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(modelRef(model))
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
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question,
          conversationId: selectedConversation,
          councilModels: selectedCouncil.map(modelRef),
          chairmanModel: modelRef(chairmanModel),
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

  if (!config) return <div className="boot">LLM Council</div>;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">LLM Council</div>
        <button className="new" onClick={() => { setSelectedConversation(null); setEvents([]); setQuestion(''); }}>Neue Conversation</button>
        <div className="history">
          {conversations.map((item) => (
            <div className={item.id === selectedConversation ? 'historyItem active' : 'historyItem'} key={item.id} onClick={() => openConversation(item.id)}>
              <div className="historyContent">
                <span>{item.title}</span>
                <small>{statusText[item.latest_status] || item.latest_status || 'bereit'}</small>
              </div>
              <button className="icon deleteConv" onClick={(e) => { e.stopPropagation(); if (confirm('Conversation endgültig löschen?')) { fetch(`/api/conversations/${item.id}`, { method: 'DELETE' }).then(() => { if (selectedConversation === item.id) { setSelectedConversation(null); setEvents([]); } refreshConversations(); }); } }} title="Löschen"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      </aside>

      <main className="workspace">
        <section className="composer">
          <textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Frage an das Council..." />
          <div className="actions">
            <button className="primary" disabled={running} onClick={startRun}><Play size={16} /> Lauf starten</button>
            <button disabled={!running} onClick={cancelRun}><PauseCircle size={16} /> Abbrechen</button>
            {currentRunId && <a className="linkButton" href={`/api/runs/${currentRunId}/export.md`}><Download size={16} /> Export</a>}
          </div>
          {error && <div className="error">{error}</div>}
        </section>

        <section className="configGrid">
          <div className="panel">
            <div className="panelHeader"><h2>OpenRouter</h2><button className="icon" onClick={addModel} title="Modell hinzufügen"><Plus size={16} /></button></div>
            <div className="providerGrid">
              <label>Base URL<input value={providerBaseUrl} onChange={(e) => setProviderBaseUrl(e.target.value)} /></label>
              <label>API-Key<input type="password" value={providerApiKey} onChange={(e) => setProviderApiKey(e.target.value)} autoComplete="off" placeholder="sk-or-..." /></label>
              <button onClick={testProvider}>Provider testen</button>
            </div>
            {providerStatus && <div className="providerStatus">{providerStatus}</div>}
            <div className="modelList">
              {models.map((model, index) => (
                <div className="modelRow" key={`${model}-${index}`}>
                  <input value={model} onChange={(e) => updateModel(index, e.target.value)} />
                  <label><input type="checkbox" checked={selectedCouncil.includes(model)} onChange={() => toggleCouncil(model)} /> Council</label>
                  <label><input type="radio" name="chairman" checked={chairmanModel === model} onChange={() => setChairmanModel(model)} /> Chairman</label>
                  <button className="icon" onClick={() => removeModel(model)} title="Modell entfernen"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <h2>Kriterien</h2>
            {criteria.map((item) => (
              <div className="criterion" key={item.id}>
                <label><input type="checkbox" checked={item.enabled} onChange={(e) => setCriteria(criteria.map((c) => c.id === item.id ? { ...c, enabled: e.target.checked } : c))} /> {item.label}</label>
                <input type="range" min="0.5" max="3" step="0.5" value={item.weight} onChange={(e) => setCriteria(criteria.map((c) => c.id === item.id ? { ...c, weight: Number(e.target.value) } : c))} />
                <span>{item.weight}</span>
              </div>
            ))}
          </div>
        </section>

        <RunView state={state} runId={currentRunId} />
      </main>
    </div>
  );
}

const phaseLabels = { answers: '1 Antworten', reviews: '2 Peer-Review', improvement: '3 Verbesserung', re_review: '4 Re-Review', synthesis: '5 Synthese' };
const phases = ['answers', 'reviews', 'improvement', 're_review', 'synthesis'];

function RunView({ state }) {
  return (
    <section className="run">
      <div className="phaseStrip">
        {phases.map((phase) => <div className={state.stage === phase ? 'phase active' : 'phase'} key={phase}>{phaseLabels[phase]}</div>)}
      </div>
      {state.summary && <Summary summary={state.summary} />}
      <div className="columns">
        <div className="panel">
          <h2>Einzelantworten</h2>
          <div className="cards">{state.responses.map((item) => <ResponseCard item={item} key={item.anonymousId || item.model} />)}</div>
        </div>
        <div className="panel">
          <h2>Rangliste (Runde 1)</h2>
          <table><tbody>{state.ranking.map((item) => <tr key={item.responseId}><td>{item.rank}</td><td>{item.responseId}<small>{item.model}</small></td><td>{item.weightedScore}</td><td>{item.validVotes} Stimmen</td></tr>)}</tbody></table>
        </div>
      </div>
      <div className="panel">
        <h2>Reviews</h2>
        <div className="reviewGrid">{state.reviews.map((item) => <ReviewCard item={item} key={item.reviewerModel || item.model} />)}</div>
      </div>
      {state.improvedResponses.length > 0 && <>
        <div className="columns">
          <div className="panel">
            <h2>Verbesserte Antworten</h2>
            <div className="cards">{state.improvedResponses.map((item) => <ResponseCard item={item} key={item.anonymousId || item.model} />)}</div>
          </div>
          <div className="panel">
            <h2>Rangliste (Runde 2)</h2>
            <table><tbody>{state.reRanking.map((item) => <tr key={item.responseId}><td>{item.rank}</td><td>{item.responseId}<small>{item.model}</small></td><td>{item.weightedScore}</td><td>{item.validVotes} Stimmen</td></tr>)}</tbody></table>
          </div>
        </div>
        <div className="panel">
          <h2>Re-Reviews</h2>
          <div className="reviewGrid">{state.reReviews.map((item) => <ReviewCard item={item} key={item.reviewerModel || item.model} />)}</div>
        </div>
      </>}
      <div className="panel final">
        <h2>Finale Antwort</h2>
        {state.finalAnswer ? <ReactMarkdown>{state.finalAnswer}</ReactMarkdown> : state.error ? <div className="error">{state.error}</div> : <p className="muted">Noch keine Synthese.</p>}
      </div>
    </section>
  );
}

function ResponseCard({ item }) {
  const meta = [item.model, `${item.latencyMs ?? '-'} ms`, `${item.usage?.total_tokens ?? item.total_tokens ?? '-'} Tokens`].filter(Boolean).join(' · ');
  return <article className="card"><header><strong>{item.anonymousId || item.model}</strong><span>{statusText[item.status] || item.status}</span></header><small>{meta}</small><ReactMarkdown>{item.content || item.error || ''}</ReactMarkdown></article>;
}

function ReviewCard({ item }) {
  const review = item.review;
  return <article className="card"><header><strong>{item.reviewerModel || item.model}</strong><span>{statusText[item.status] || item.status}</span></header>{review ? <pre>{JSON.stringify(review, null, 2)}</pre> : <p>{item.error}</p>}</article>;
}

function Summary({ summary }) {
  return <div className="summary"><span>{summary.durationMs} ms</span><span>{summary.modelCalls} Calls</span><span>{summary.successfulCalls} ok</span><span>{summary.failedCalls} Fehler</span><span>{summary.tokenTotals?.total || 0} Tokens</span></div>;
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
  const events = [{ type: 'stage', stage: run.stage }];
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
