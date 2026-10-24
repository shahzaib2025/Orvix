import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { ArrowLeft, ArrowUpRight, BookOpen, Compass, Expand, Hammer, Leaf, LoaderCircle, Moon, MousePointer2, Pause, Play, Plus, Radar, RotateCcw, Search, Ship, Sun, Users, X } from 'lucide-react';
import { createIslandWorld, districts } from './islandWorld';
import type { DistrictId, IslandSettings, IslandWorld } from './islandWorld';
import type { TinyAgentListing, TinyWorkflowListing } from '../desktop';
import { subscribeTinyWorkflows } from '../tinyWorkflowSubscription';
import { subscribeTinyAgentListing } from '../tinyAgentSubscription';
import { islandResidents, workflowResidents } from './islandResidents';
import './island-village.css';

const icons = { workshop: Hammer, garden: Leaf, library: BookOpen, harbor: Ship };
const emptyRules: TinyAgentListing = { rules: [], history: [], shutdownPending: null };

export default function IslandVillageDemo({ reducedMotion = false, onManageWorkers }: { reducedMotion?: boolean; onManageWorkers?: (id?: string) => void }) {
  const host = useRef<HTMLDivElement>(null), viewport = useRef<HTMLDivElement>(null);
  const world = useRef<IslandWorld | null>(null);
  const [selected, setSelected] = useState<DistrictId | null>(null);
  const [residentId, setResidentId] = useState<string | null>(null);
  const [ready, setReady] = useState(false), [error, setError] = useState('');
  const [fullscreen, setFullscreen] = useState(false), [showRoster, setShowRoster] = useState(() => window.innerWidth > 750), [showNames, setShowNames] = useState(true);
  const [search, setSearch] = useState(''), [rules, setRules] = useState(emptyRules), [ruleError, setRuleError] = useState('');
  
  const [now, setNow] = useState(Date.now());
  const [workflows,setWorkflows]=useState<TinyWorkflowListing>({sequence:0,definitions:[],runs:[]});
  useEffect(()=>{const bridge=window.orvixDesktop;if(bridge?.listTinyWorkflows) return subscribeTinyWorkflows(bridge,setWorkflows,cause=>setRuleError(String(cause)));},[]);
  const [settings, setSettings] = useState<IslandSettings>({ paused: reducedMotion, night: false, tour: false, speed: 1, reducedMotion });
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const systemMotion = useRef(false);
  const residents = useMemo(() => [...islandResidents(rules, now),...workflowResidents(workflows)], [rules, workflows, now]);
  const resident = residents.find(person => person.id === residentId);
  const watcher = resident?.kind === 'watcher' ? rules.rules.find(rule => `watcher:${rule.id}` === residentId) : undefined;
  const district = districts.find(item => item.id === selected);
  const live = !!window.orvixDesktop?.listTinyAgents;
  const working = residents.filter(person => ['executing', 'delivering', 'shutdown_pending'].includes(person.status)).length;
  const monitoring = residents.filter(person => person.status === 'watching').length;
  const matching = residents.filter(person => (!selected || person.district === selected) && `${person.name} ${person.task}`.toLowerCase().includes(search.toLowerCase()));
  const [busyAction, setBusyAction] = useState(false), [actionError, setActionError] = useState('');

  const select = useCallback((id: DistrictId | null) => { setSelected(id); setResidentId(null); world.current?.focus(id); }, []);
  const inspect = useCallback((id: string) => { if (id.startsWith('demo-')) return; setResidentId(id); setShowRoster(true); world.current?.selectResident(id); }, []);
  useEffect(() => {
    const bridge = window.orvixDesktop;
    if (!bridge?.listTinyAgents) return;
    return subscribeTinyAgentListing(bridge, next => { setRules(next); setRuleError(''); }, cause => setRuleError(cause instanceof Error ? cause.message : 'PC watchers could not be loaded.'));
  }, []);
  useEffect(() => {
    
    const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer);
  }, [rules.rules]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => { systemMotion.current = media.matches; setSettings(previous => ({ ...previous, reducedMotion: reducedMotion || media.matches, paused: reducedMotion || media.matches ? true : previous.paused, tour: reducedMotion || media.matches ? false : previous.tour })); };
    sync(); media.addEventListener('change', sync); return () => media.removeEventListener('change', sync);
  }, [reducedMotion]);
  useEffect(() => {
    if (!host.current) return;
    try { world.current = createIslandWorld(host.current, { ...settingsRef.current, reducedMotion: reducedMotion || systemMotion.current }, select, inspect); setReady(true); }
    catch (cause) { setError(cause instanceof Error && /webgl|context/i.test(cause.message) ? 'Enable hardware acceleration to view the island. Your assignments are still available here.' : 'The 3D view could not load. Your assignments remain available.'); }
    return () => { world.current?.dispose(); world.current = null; };
  }, [select, inspect]);
  useEffect(() => { world.current?.update({ ...settings, overlayWidth: showRoster ? 322 : 0 }); }, [settings, ready, showRoster]);
  useEffect(() => { if (live) world.current?.setResidents(residents); }, [residents, live, ready]);
  useEffect(() => { if (residentId && !resident) { setResidentId(null); world.current?.focus(null); } }, [residentId, resident]);
  useEffect(() => { const sync = () => { setFullscreen(document.fullscreenElement === viewport.current); world.current?.resize(); }; document.addEventListener('fullscreenchange', sync); return () => document.removeEventListener('fullscreenchange', sync); }, []);
  const change = <K extends keyof IslandSettings>(key: K, value: IslandSettings[K]) => setSettings(previous => ({ ...previous, [key]: value }));
  const toggleFullscreen = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await viewport.current?.requestFullscreen(); } catch { setFullscreen(false); } };
  const commandWorker = async () => {
    if (!watcher || !window.orvixDesktop || busyAction) return;
    setBusyAction(true); setActionError('');
    try { await window.orvixDesktop.setTinyAgentEnabled(watcher.id, !watcher.enabled); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : 'The PC worker could not be updated.'); }
    finally { setBusyAction(false); }
  };

  return <div className={`island-page island-connected-page${!showNames ? ' island-hide-names' : ''}${settings.night ? ' island-night' : ''}`}>
    <div className="island-world" ref={viewport}>
      <div className="island-renderer" ref={host}/>
      {!ready && !error && <div className="island-loading" role="status"><LoaderCircle size={24}/><strong>Opening your little world…</strong></div>}
      {error && <div className="island-loading island-error" role="alert"><Compass size={30}/><strong>Your island is just over the horizon.</strong><p>{error}</p></div>}
      <header className="island-live-header"><div><span className="island-live-eyebrow">SUPPORT / YOUR AGENT WORLD</span><h1>Haven Island<span>01</span></h1><p>A little world, <em>at work.</em></p></div><span className={`island-live-badge${ruleError ? ' sync-error' : ''}`}><i/>{live ? ruleError ? 'Sync needs attention' : `${residents.length} PC workers · ${monitoring} monitoring${working ? ` · ${working} acting` : ''}` : 'Interactive demo'}</span></header>
      <div className="island-view-actions"><div className="island-day-switch" role="group" aria-label="Island lighting"><button onClick={() => change('night', false)} className={!settings.night ? 'selected' : ''} aria-label="Daylight" aria-pressed={!settings.night}><Sun size={15}/><span>Day</span></button><button onClick={() => change('night', true)} className={settings.night ? 'selected' : ''} aria-label="Moonlight" aria-pressed={settings.night}><Moon size={14}/><span>Night</span></button></div><button className="island-glass-button" onClick={toggleFullscreen} aria-label={fullscreen ? 'Exit fullscreen' : 'Explore fullscreen'} title="Fullscreen">{fullscreen ? <X size={16}/> : <Expand size={16}/>}</button><button className={`island-glass-button${showRoster ? ' active' : ''}`} onClick={() => setShowRoster(!showRoster)} aria-label={showRoster ? 'Hide agent roster' : 'Show agent roster'} aria-expanded={showRoster} title="Agent roster"><Users size={16}/></button></div>

      {showRoster && <aside className="island-live-roster" aria-label="Island agents">
        {resident ? <><div className="island-roster-heading"><button onClick={() => { setResidentId(null); world.current?.focus(selected); }} aria-label="Back to island agents"><ArrowLeft size={14}/></button><span>PC WORKER</span><button onClick={() => setShowRoster(false)} aria-label="Close agent roster"><X size={14}/></button></div><div className="island-agent-detail"><span className={`island-avatar island-avatar-${resident.district}`}>{resident.name[0]?.toUpperCase()}</span><h2>{resident.name}</h2><span className={`island-resident-state state-${resident.status}`}><i/>{resident.statusLabel}</span><h3>Assigned task</h3><p className="island-assigned-topic">{resident.task}</p><span className="island-agent-home"><Compass size={11}/>{districts.find(item => item.id === resident.district)?.name}</span>
          {resident.kind==='workflow'&&<button onClick={()=>onManageWorkers?.(resident.id)}>Review workflow & live work <ArrowUpRight size={12}/></button>}{watcher && <><p className="island-watcher-explainer">This worker follows the PC conditions and actions you assigned in Tiny Agents.</p><div className="island-agent-controls"><button disabled={busyAction || watcher.draft} onClick={() => void commandWorker()}>{watcher.enabled ? <Pause size={12}/> : <Play size={12}/>} {watcher.enabled ? 'Pause PC worker' : 'Resume PC worker'}</button><button onClick={() => onManageWorkers?.(watcher.id)}>Manage PC worker <ArrowUpRight size={12}/></button></div>{actionError && <p role="alert">{actionError}</p>}<h3>Assigned actions</h3>{(watcher.actions || [watcher.action]).map((action, index) => <p className="island-watcher-action" key={index}>{action.type.replaceAll('_', ' ')} · {action.message || action.target || 'When conditions pass'}</p>)}<small>Last triggered: {watcher.lastTriggeredAt ? new Date(watcher.lastTriggeredAt).toLocaleString() : 'Not yet'}</small><div className="island-watcher-history">{rules.history.filter(event => event.ruleId === watcher.id).slice(0, 6).map(event => <p key={event.id}><time>{new Date(event.at).toLocaleTimeString()}</time>{event.message}</p>)}</div></>}
        </div></> : <><div className="island-roster-heading"><div><span>YOUR LITTLE COMMUNITY</span><h2>{district ? district.name : 'Agents on the island'}</h2></div><button onClick={() => setShowRoster(false)} aria-label="Close agent roster"><X size={14}/></button></div><label className="island-roster-search"><Search size={13}/><input aria-label="Search island agents" value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a name or assignment"/></label>{selected && <button className="island-all-districts" onClick={() => select(null)}>All districts <ArrowUpRight size={12}/></button>}
          {matching.length ? <div className="island-roster-list">{matching.map(person => <button key={person.id} onClick={() => inspect(person.id)}><span className={`island-avatar island-avatar-${person.district}`}>{person.name[0]?.toUpperCase()}</span><span><strong>{person.name}</strong><small>{person.task}</small><em className={`state-${person.status}`}><Radar size={10}/> {person.statusLabel}</em></span><ArrowUpRight size={13}/></button>)}</div> : <div className="island-empty-roster"><SparkleMark/><strong>{residents.length ? 'No agents in this corner yet.' : live ? 'A home for your next idea.' : 'Meet your future little team.'}</strong><p>{search ? 'Try another name or assignment.' : 'Create PC workers in Tiny Agents. Assign their conditions, actions, and island work area.'}</p></div>}
          <button className="island-add-worker" onClick={() => onManageWorkers?.()} disabled={!onManageWorkers}><Plus size={14}/>Create a PC worker <ArrowUpRight size={13}/></button><p className="island-roster-footnote">{live ? 'PC worker states and action history come from Tiny Agents. Scenery controls only change the view.' : 'Demo scenery. Open the desktop app to connect real workers.'}</p>{(ruleError) && <p className="island-sync-message" role="alert">{ruleError}</p>}
        </>}
      </aside>}

      <nav className="island-district-dock" aria-label="Island districts">{districts.map((item, index) => { const Icon = icons[item.id], count = residents.filter(person => person.district === item.id).length, busy = residents.filter(person => person.district === item.id && ['executing', 'delivering', 'shutdown_pending'].includes(person.status)).length; return <button key={item.id} aria-pressed={selected === item.id} className={selected === item.id ? 'selected' : ''} style={{ '--district-color': item.color } as CSSProperties} onClick={() => { select(selected === item.id ? null : item.id); setShowRoster(true); }}><Icon size={18} strokeWidth={1.5}/><span><small>0{index + 1} / {item.role}</small><strong>{item.name}</strong><em>{live ? `${count} residents${busy ? ` · ${busy} acting` : ''}` : `${item.people} demo villagers`}</em></span><ArrowUpRight size={13}/></button>; })}</nav>
      <div className="island-toolbar"><div className="island-play-controls"><button onClick={() => change('paused', !settings.paused)} aria-label={settings.paused ? 'Resume scenery' : 'Pause scenery'} disabled={!ready || settings.reducedMotion} title="Scenery only; PC workers continue">{settings.paused ? <Play size={15}/> : <Pause size={15}/>}</button><span className="island-toolbar-divider"/><button onClick={() => change('speed', settings.speed === 1 ? 2 : 1)} aria-label={`Scenery speed ${settings.speed}x`} disabled={!ready || settings.reducedMotion} title="Animation speed"><span className="island-speed">{settings.speed}×</span></button><button aria-label="Show villager names" aria-pressed={showNames} onClick={() => setShowNames(!showNames)} title="Show names" className={showNames ? 'active' : ''}><Users size={14}/></button></div><span className="island-controls-hint"><MousePointer2 size={12}/>Drag to orbit <i/> Scroll to explore</span><div className="island-camera-controls"><button onClick={() => { select(null); change('tour', !settings.tour); }} aria-label="Island tour" aria-pressed={settings.tour} disabled={!ready || settings.reducedMotion} className={settings.tour ? 'active' : ''}><Compass size={15}/><span>Tour</span></button><button onClick={() => { select(null); change('tour', false); world.current?.reset(); }} aria-label="Reset island view" disabled={!ready}><RotateCcw size={15}/></button></div></div>
      <div className="island-scene-caption">{live ? `LIVE WORLD · ${residents.length > 64 ? 'Showing 64 residents · ' : ''}Animations illustrate status. Action history shows PC work.` : 'DEMO WORLD · PC workers start in Tiny Agents.'}</div>
    </div>
  </div>;
}
function SparkleMark() { return <span className="island-empty-mark">✦</span>; }


