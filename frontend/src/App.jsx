
import React, { useEffect, useState } from 'react';
import {
  Activity,
  ArrowRight,
  ArrowLeft,
  Clock3,
  ImagePlus,
  Keyboard,
  Sparkles,
  Eye,
  History,
  Lightbulb,
  MessageCircle,
  Send,
  LoaderCircle,
  HelpCircle,
  UploadCloud,
  ShieldCheck
} from 'lucide-react';

// API helper: hard timeout (so nothing can spin forever) + readable errors
const api = async (path, opts = {}, timeoutMs = 30000) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let r;
  try {
    r = await fetch((import.meta.env.VITE_API_BASE_URL || '') + path, {
      ...opts,
      signal: ctrl.signal
    });
  } catch (e) {
    throw Error(
      e.name === 'AbortError'
        ? 'The server took too long to respond. Please try again.'
        : 'Cannot reach the backend. Is it running on port 8000?'
    );
  } finally {
    clearTimeout(timer);
  }

  const body = await r.text();
  let d = {};
  try {
    d = body ? JSON.parse(body) : {};
  } catch {
    d = {};
  }

  if (!r.ok) {
    // FastAPI validation errors (422) return detail as a list of objects
    const detail = Array.isArray(d.detail)
      ? d.detail.map(x => `${(x.loc || []).slice(1).join('.')}: ${x.msg}`).join('; ')
      : d.detail;
    throw Error(
      detail || `API error ${r.status}: ${body.slice(0, 300) || 'No response body'}`
    );
  }

  return d;
};

// Shrink big screenshots before upload: faster upload, faster Gemini read.
const shrinkImage = file =>
  new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const max = 1280;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      if (scale === 1 && file.size < 1.5 * 1024 * 1024) return resolve(file);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(
        b => resolve(b ? new File([b], 'scoreboard.jpg', { type: 'image/jpeg' }) : file),
        'image/jpeg',
        0.9
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });

// Default match details
const initial = {
  batting_team: 'India',
  bowling_team: 'Australia',
  format: 'T20',
  innings: 'second',
  score: '126',
  wickets: '4',
  overs: '15.2',
  target: '180',
  recent_events: ['1', '0', 'W', '1', '4', '0'],
  event_history_available: true
};

// Header
function Header({ how }) {
  return (
    <header className="top">
      <div className="brand">
        <span><Activity /></span>
        OVERBRIEF
      </div>

      <button className="help" onClick={how}>
        <HelpCircle size={18} />
        HOW IT WORKS
      </button>
    </header>
  );
}

// Home page
function Home({ start, samples, how }) {
  return (
    <>
      <section className="hero wrap">
        <div>
          <label className="eyebrow">
            ● YOUR AI CRICKET COMPANION
          </label>

          <h1>
            Missed the match?
            <br />
            <em>Get back in the game.</em>
          </h1>

          <p>
            Catch up on what happened, understand why it matters and know
            what to watch next — without digging through scorecards.
          </p>

          <div className="actions">
            <button className="primary" onClick={start}>
              Catch me up <ArrowRight />
            </button>

            <button className="plain" onClick={how}>
              How it works
            </button>
          </div>

          <div className="micro">
            <span><Clock3 /> A quick 30-second briefing</span>
            <span><ShieldCheck /> Based on your match details</span>
          </div>
        </div>

        <div className="preview">
          <div className="preview-head">
            EXAMPLE MATCH <span>T20 · CHASE</span>
          </div>

          <div className="teams">
            <div>
              <b className="flag india">IND</b>
              <small>India</small>
              <strong>126/4</strong>
            </div>

            <i>VS</i>

            <div>
              <b className="flag aus">AUS</b>
              <small>Australia</small>
              <strong>179/7</strong>
            </div>
          </div>

          <div className="equation">
            <small>INDIA NEED</small>
            <strong>54 <small>runs</small></strong>
            <small>FROM 28 BALLS</small>
          </div>

          <div className="preview-note">
            <Sparkles />
            <p>
              <b>The chase is getting demanding.</b>
              <br />
              The required rate has climbed above 11 runs per over.
            </p>
          </div>

          <small className="disclaimer">
            Illustrative sample · Not live data
          </small>
        </div>
      </section>

      <section className="wrap choose">
        <label className="eyebrow">START WITH YOUR MATCH</label>
        <h2>What would you like to do?</h2>

        <div className="tiles">
          <button onClick={start}>
            <History />
            <span>
              <b>Catch me up</b>
              <small>
                I missed part of a match and want the quick version.
              </small>
            </span>
            <ArrowRight />
          </button>

          <button onClick={start}>
            <Activity />
            <span>
              <b>Explain this match</b>
              <small>
                Help me understand the score and situation.
              </small>
            </span>
            <ArrowRight />
          </button>

          <button onClick={samples}>
            <Sparkles />
            <span>
              <b>Try a sample match</b>
              <small>
                Explore with a ready-made scenario.
              </small>
            </span>
            <ArrowRight />
          </button>
        </div>
      </section>
    </>
  );
}

// Match input page
function InputPage({
  back,
  samples,
  generate,
  extracting,
  loading,
  extract,
  serverError
}) {
  const [f, S] = useState(initial);
  const [events, E] = useState(true);
  const [error, Err] = useState('');
  const [detected, Det] = useState(null);

  const file = React.useRef();

  const set = (k, v) => {
    S(o => ({ ...o, [k]: v }));
  };

  const useSample = s => {
    S({
      ...s.match,
      score: String(s.match.score),
      wickets: String(s.match.wickets),
      target: s.match.target ? String(s.match.target) : ''
    });

    E(s.match.event_history_available);
    Err('');
  };

  // Validate and submit match details
  const submit = () => {
    if (!f.batting_team.trim() || !f.bowling_team.trim()) {
      return Err('Enter both team names.');
    }

    if (
      f.batting_team.trim().toLowerCase() ===
      f.bowling_team.trim().toLowerCase()
    ) {
      return Err('Choose two different teams.');
    }

    if (f.score === '' || Number.isNaN(Number(f.score)) || Number(f.score) < 0) {
      return Err('Enter the current score.');
    }

    if (f.wickets === '' || Number(f.wickets) < 0 || Number(f.wickets) > 10) {
      return Err('Wickets must be between 0 and 10.');
    }

    // Correct cricket overs validation
    if (!/^\d+(\.[0-5])?$/.test(f.overs)) {
      return Err('Use cricket overs notation, e.g. 16.2.');
    }

    if (f.innings === 'second' && !f.target) {
      return Err('Enter the target score.');
    }

    Err('');

    generate({
      ...f,
      score: Number(f.score),
      wickets: Number(f.wickets),
      target: f.innings === 'second' ? Number(f.target) : null,
      recent_events: events ? f.recent_events : [],
      event_history_available: events
    });
  };

  // Upload and extract scoreboard image
  const upload = async e => {
    const file = e.target.files?.[0];

    if (!file) return;

    Err('');

    const allowedTypes = [
      'image/png',
      'image/jpeg',
      'image/webp'
    ];

    if (!allowedTypes.includes(file.type)) {
      Err('Please upload a PNG, JPG or WEBP image.');
      e.target.value = '';
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      Err('Image must be smaller than 8 MB.');
      e.target.value = '';
      return;
    }

    Det(null);

    try {
      const d = await extract(file);
      const x = d.extracted || {};
      Det({ values: x, missing: d.missing || [] });

      S(o => ({
        ...o,
        batting_team: x.batting_team || o.batting_team,
        bowling_team: x.bowling_team || o.bowling_team,
        format: x.format || o.format,
        innings: x.innings || (x.target != null ? 'second' : o.innings),
        score: x.score != null ? String(x.score) : o.score,
        wickets: x.wickets != null ? String(x.wickets) : o.wickets,
        overs: x.overs || o.overs,
        target: x.target != null ? String(x.target) : o.target
      }));
    } catch (err) {
      Err(err.message);
    } finally {
      e.target.value = '';
    }
  };

  return (
    <main className="wrap narrow">
      <button className="back" onClick={back}>
        <ArrowLeft /> Back home
      </button>

      <label className="eyebrow">YOUR MATCH · STEP 01</label>

      <h1>
        Let's get you <em>caught up.</em>
      </h1>

      <p className="sub">
        Share the match situation. We'll turn the numbers and recent
        events into a quick briefing.
      </p>

      <div className="method">
        <button onClick={() => file.current.click()}>
          <ImagePlus />
          <b>Upload scoreboard</b>
          <small>
            Extract visible details from a screenshot with Gemini.
          </small>
          <span>
            {extracting ? 'Reading image…' : 'Choose image →'}
          </span>
        </button>

        <input
          ref={file}
          hidden
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={upload}
        />

        <button
          onClick={() =>
            document.getElementById('matchform').scrollIntoView({
              behavior: 'smooth'
            })
          }
        >
          <Keyboard />
          <b>Enter manually</b>
          <small>Fill in the match details yourself.</small>
          <span>Enter details →</span>
        </button>
      </div>

      {extracting && (
        <div className="panel">
          <LoaderCircle className="spin" /> Reading your scoreboard… this usually
          takes a few seconds.
        </div>
      )}

      {detected && !extracting && (
        <div className="panel confirm">
          <h3>
            Scoreboard detected <small>CONFIRM BELOW</small>
          </h3>

          <table className="detected">
            <tbody>
              {[
                ['Batting team', detected.values.batting_team],
                ['Bowling team', detected.values.bowling_team],
                ['Format', detected.values.format],
                ['Innings', detected.values.innings],
                [
                  'Current score',
                  detected.values.score != null && detected.values.wickets != null
                    ? `${detected.values.score}/${detected.values.wickets}`
                    : null
                ],
                ['Overs', detected.values.overs],
                ['Target', detected.values.target]
              ].map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td>{v != null ? String(v) : 'Not found — enter below'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="hint">
            Please verify these values and correct anything below before
            generating. A screenshot shows the current state only — it cannot
            tell us what happened in the missed overs, so add recent deliveries
            if you know them.
          </p>
        </div>
      )}

      <div className="panel" id="matchform">
        <h3>
          01　Match details <small>REQUIRED</small>
        </h3>

        <div className="fields">
          <label>
            Batting team
            <input
              value={f.batting_team}
              onChange={e => set('batting_team', e.target.value)}
            />
          </label>

          <label>
            Bowling team
            <input
              value={f.bowling_team}
              onChange={e => set('bowling_team', e.target.value)}
            />
          </label>

          <label>
            Format
            <select
              value={f.format}
              onChange={e => set('format', e.target.value)}
            >
              <option>T20</option>
              <option>ODI</option>
              <option>Test</option>
            </select>
          </label>

          <label>
            Innings
            <select
              value={f.innings}
              onChange={e => set('innings', e.target.value)}
            >
              <option value="second">Second innings · Chase</option>
              <option value="first">First innings</option>
            </select>
          </label>

          <label>
            Current score
            <input
              type="number"
              value={f.score}
              onChange={e => set('score', e.target.value)}
            />
          </label>

          <label>
            Wickets lost
            <input
              type="number"
              min="0"
              max="10"
              value={f.wickets}
              onChange={e => set('wickets', e.target.value)}
            />
          </label>

          <label>
            Overs completed
            <input
              value={f.overs}
              onChange={e => set('overs', e.target.value)}
              placeholder="15.2"
            />
          </label>

          {f.innings === 'second' && (
            <label>
              Target score
              <input
                type="number"
                value={f.target}
                onChange={e => set('target', e.target.value)}
              />
            </label>
          )}
        </div>

        <p className="hint">
          Overs use cricket notation: 15.2 means 15 overs and 2 balls,
          not decimal 15.2.
        </p>
      </div>

      <div className="panel">
        <h3>
          02　Recent deliveries <small>OPTIONAL</small>
        </h3>

        <p className="hint">
          Enter the last six deliveries, oldest to newest.
        </p>

        <div className="balls">
          {f.recent_events.map((v, i) => (
            <label key={i}>
              Ball {i + 1}

              <select
                disabled={!events}
                value={v}
                onChange={e =>
                  set(
                    'recent_events',
                    f.recent_events.map((x, j) =>
                      i === j ? e.target.value : x
                    )
                  )
                }
              >
                {['0', '1', '2', '3', '4', '6', 'W', 'Wd', 'Nb'].map(x => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>

        <label className="check">
          <input
            type="checkbox"
            checked={events}
            onChange={e => E(e.target.checked)}
          />
          I know the recent deliveries
        </label>

        <p className="hint">
          Untick this if you don't know them. We'll make a scoreboard-based
          briefing instead.
        </p>
      </div>

      <div className="panel">
        <h3>★　Or try a sample match</h3>

        {(Array.isArray(samples) ? samples : []).map(s => (
          <button
            className="sample"
            key={s.id}
            onClick={() => useSample(s)}
          >
            <span>
              <b>{s.name}</b>
              <small>{s.description}</small>
            </span>

            <ArrowRight />
          </button>
        ))}
      </div>

      {(error || serverError) && (
        <div className="error">{error || serverError}</div>
      )}

      <button
        className="primary wide"
        disabled={loading || extracting}
        onClick={submit}
      >
        {loading ? (
          <>
            <LoaderCircle className="spin" />
            Creating briefing…
          </>
        ) : (
          'Generate my catch-up →'
        )}
      </button>

      
    </main>
  );
}

// Individual briefing insight
function Insight({ icon, n, title, text }) {
  return (
    <section className="insight">
      <div className="insight-head">
        <span>{icon}</span>

        <div>
          <small>{n}</small>
          <h2>{title}</h2>
        </div>
      </div>

      <p>{text}</p>
    </section>
  );
}

// Briefing page
function Briefing({ data, back, ask, asking, chat }) {
  const [m, M] = useState('');

  const c = data.calculations;
  const b = data.briefing;

  return (
    <main className="wrap narrow">
      <button className="back" onClick={back}>
        <ArrowLeft /> Edit match details
      </button>

      <label className="eyebrow">YOUR MATCH BRIEFING</label>

      <h1>
        Here's what <em>you missed.</em>
      </h1>

      <p className="sub">
        A concise catch-up based on the match information you provided.
      </p>

      <div className="scorebox">
        <div className="scoretop">
          {data.match.batting_team.toUpperCase()} ·{' '}
          {data.match.innings.toUpperCase()} INNINGS

          <span>
            {data.generated_by === 'gemini'
              ? '✦ GEMINI AI'
              : data.generated_by === 'fallback'
              ? 'CALCULATED · AI UNAVAILABLE'
              : 'DEMO MODE'}
          </span>
        </div>

        <strong>
          {data.match.score}/{data.match.wickets}
        </strong>

        <small>
          {data.match.overs} overs · vs {data.match.bowling_team}
        </small>

      </div>

      <Insight
        icon={<History />}
        n="01 · THE RECAP"
        title="What happened?"
        text={b.what_happened}
      />

      {!c.event_history_available && (
        <div className="warning">
          No recent deliveries were supplied, so the missed overs can't be
          reliably summarised. Below is the current scoreboard situation only.
        </div>
      )}

      <section className="insight">
        <div className="insight-head">
          <span><Activity /></span>
          <div>
            <small>02 · THE NUMBERS</small>
            <h2>Match situation</h2>
          </div>
        </div>

        <div className="metrics">
          <div>
            <small>CURRENT RATE</small>
            <b>{c.current_run_rate}</b>
          </div>

          <div>
            <small>WICKETS LEFT</small>
            <b>{c.wickets_remaining}</b>
          </div>

          {data.match.innings === 'second' && (
            <>
              <div>
                <small>RUNS NEEDED</small>
                <b>{c.runs_remaining}</b>
              </div>

              <div>
                <small>BALLS LEFT</small>
                <b>{c.legal_balls_remaining}</b>
              </div>

              <div>
                <small>REQUIRED RATE</small>
                <b>{c.required_run_rate ?? '—'}</b>
              </div>
            </>
          )}
        </div>

        {data.match.innings === 'second' && (
          <p className="equationline">
            Need <b>{c.runs_remaining} runs</b> from{' '}
            <b>{c.legal_balls_remaining} balls</b> to reach{' '}
            {data.match.target}.
          </p>
        )}
      </section>

      <Insight
        icon={<Lightbulb />}
        n="03 · THE CONTEXT"
        title="Why it matters"
        text={b.why_it_matters}
      />

      <Insight
        icon={<Eye />}
        n="04 · LOOK AHEAD"
        title="What to watch next"
        text={b.what_to_watch}
      />

      <div className="note">
        ⓘ　{b.confidence_note}
      </div>

      <div className="chat">
        <h2>
          <MessageCircle /> 05 · Ask OVERBRIEF
        </h2>

        <p>Ask a question about this match.</p>

        {chat.map((x, i) => (
          <div className={'bubble ' + x.role} key={i}>
            <small>
              {x.role === 'user' ? 'YOU' : 'OVERBRIEF'}
            </small>
            <p>{x.text}</p>
          </div>
        ))}

        {chat.length === 0 && (
          <div className="suggestions">
            {[
              'Why is the required run rate important?',
              'What does the recent sequence tell us?',
              'What information is missing?'
            ].map(q => (
              <button key={q} onClick={() => ask(q)}>
                {q}
              </button>
            ))}
          </div>
        )}

        <form
          onSubmit={e => {
            e.preventDefault();

            if (m.trim()) ask(m);

            M('');
          }}
        >
          <input
            value={m}
            onChange={e => M(e.target.value)}
            placeholder="Ask about the match…"
          />

          <button disabled={asking || !m.trim()}>
            {asking ? (
              <LoaderCircle className="spin" />
            ) : (
              <Send />
            )}
          </button>
        </form>
      </div>

      <button className="secondary wide" onClick={back}>
        Analyse another match
      </button>
    </main>
  );
}

// Main application
export default function App() {
  const [page, P] = useState('home');
  const [samples, S] = useState([]);
  const [data, D] = useState(null);
  const [chat, C] = useState([]);
  const [busy, B] = useState(false);
  const [extracting, X] = useState(false);
  const [asking, A] = useState(false);
  const [modal, H] = useState(false);
  const [genError, GE] = useState('');

  // Load sample matches
  useEffect(() => {
    api('/api/match/samples')
      .then(d => S(Array.isArray(d) ? d : []))
      .catch(() => S([]));
  }, []);

  // Generate match briefing
  const generate = async match => {
    B(true);
    GE('');

    try {
      D(
        await api(
          '/api/match/brief',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ match })
          },
          75000
        )
      );

      C([]);
      P('brief');
      window.scrollTo(0, 0);
    } catch (e) {
      GE(e.message);
    } finally {
      B(false);
    }
  };

  // Extract scoreboard image
  const extract = async file => {
    X(true);

    try {
      const fd = new FormData();
      fd.append('file', await shrinkImage(file));

      return await api(
        '/api/match/extract',
        { method: 'POST', body: fd },
        100000
      );
    } finally {
      X(false);
    }
  };

  // Ask a follow-up question
  const ask = async q => {
    C(o => [...o, { role: 'user', text: q }]);
    A(true);

    try {
      const d = await api('/api/match/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          match: data.match,
          calculations: data.calculations,
          briefing: data.briefing,
          question: q
        })
      });

      C(o => [
        ...o,
        { role: 'assistant', text: d.answer }
      ]);
    } catch (e) {
      C(o => [
        ...o,
        {
          role: 'assistant',
          text: 'Could not answer: ' + e.message
        }
      ]);
    } finally {
      A(false);
    }
  };

  return (
    <div className="app">
      <Header how={() => H(true)} />

      {page === 'home' ? (
        <Home
          start={() => P('input')}
          samples={() => P('input')}
          how={() => H(true)}
        />
      ) : page === 'input' ? (
        <InputPage
          back={() => P('home')}
          samples={samples}
          generate={generate}
          loading={busy}
          extracting={extracting}
          extract={extract}
          serverError={genError}
        />
      ) : (
        <Briefing
          data={data}
          back={() => P('input')}
          ask={ask}
          asking={asking}
          chat={chat}
        />
      )}

      <footer>
        <b>OVERBRIEF</b>
        <p>Understand the game beyond the scoreboard.</p>
      </footer>

      {modal && (
        <div className="overlay" onClick={() => H(false)}>
          <div
            className="modal"
            onClick={e => e.stopPropagation()}
          >
            <button onClick={() => H(false)}>×</button>

            <label className="eyebrow">HOW IT WORKS</label>

            <h2>From scoreboard to understanding.</h2>

            <p>
              <b>1. Share match information.</b> Enter the score or upload
              a screenshot.
            </p>

            <p>
              <b>2. Calculate the facts.</b> Python calculates rates, balls
              and wickets remaining.
            </p>

            <p>
              <b>3. Get an AI catch-up.</b> Gemini explains the situation
              and answers follow-up questions.
            </p>

            
          </div>
        </div>
      )}
    </div>
  );
}
