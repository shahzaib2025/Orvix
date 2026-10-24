import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Home, Lock, LockKeyholeOpen, Pause, Play } from "lucide-react";
import { OrvixPet, PetController, type PetState } from "../Pet";

type DesktopBounds = { x: number; y: number; width: number; height: number; displays?:{x:number;y:number;width:number;height:number}[]; petX?:number; petY?:number };
const PET_LEFT = 92;
const PET_WIDTH = 175;
const PET_TOP = 184;

export default function DesktopPet() {
  const rootRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<PetController | null>(null);
  const desktopBoundsRef = useRef<DesktopBounds | null>(null);
  const positionRef = useRef<{ x: number; y: number } | null>(null);
  const visualRef = useRef<PetState | null>(null);
  const interactiveRef = useRef(false);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const [pet, setPet] = useState<PetState | null>(null);
  const [hovered, setHovered] = useState(false);
  const [locked, setLocked] = useState(false);
  const [paused, setPaused] = useState(false);
  const [liveOutput, setLiveOutput] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const captionRef=useRef<HTMLDivElement>(null);
  const followCaptionRef=useRef(true);
  useEffect(()=>{const caption=captionRef.current;if(caption&&followCaptionRef.current)caption.scrollTop=caption.scrollHeight;},[liveOutput]);

  const setInteractive = (interactive: boolean) => {
    if (interactiveRef.current === interactive) return;
    interactiveRef.current = interactive;
    window.orvixDesktop?.setPetInteractive(interactive);
  };

  useEffect(() => {
    let alive = true;
    let unsubscribeActivity: (() => void) | undefined;
    let unsubscribePetOutput: (() => void) | undefined;
    let unsubscribePosition: (() => void) | undefined;
    let controller: PetController | undefined;

    const initialize = async () => {
      const desktop = window.orvixDesktop;
      if (!desktop) return;
      const bounds = await desktop.getPetScreenBounds();
      if (!alive) return;
      desktopBoundsRef.current = bounds;
      unsubscribePetOutput = desktop.onPetOutput?.(value => {
        if (typeof value.text==='string') {if(!value.text)followCaptionRef.current=true;setLiveOutput(value.text);}
        setIsSpeaking(value.speaking);
      });
      const controllerBounds = {
        width: bounds.width,
        height: bounds.height,
        displays: bounds.displays,
        taskbarHeight: 0,
      };
      controller = new PetController(
        bounds.petX ?? Math.max(10, bounds.width - 230),
        bounds.petY ?? Math.max(10, bounds.height - 253),
      );
      controller.setScreen(controllerBounds);
      controllerRef.current = controller;
      unsubscribePosition=desktop.onPetPosition?.(value=>{
        if(!alive)return;
        const oldBounds=desktopBoundsRef.current;
        desktopBoundsRef.current=value;
        controller?.setScreen({width:value.width,height:value.height,displays:value.displays,taskbarHeight:0});
        if(typeof value.petX==='number'&&typeof value.petY==='number'){
          positionRef.current={x:value.petX,y:value.petY};controller?.syncDesktopPosition(value.petX,value.petY);
        }
        if(dragRef.current&&oldBounds&&(oldBounds.x!==value.x||oldBounds.y!==value.y||oldBounds.width!==value.width||oldBounds.height!==value.height)){
          const pointerId=dragRef.current.pointerId;dragRef.current=null;
          if(rootRef.current?.hasPointerCapture(pointerId))rootRef.current.releasePointerCapture(pointerId);
          controller?.endDrag();setInteractive(false);
        }
      });
      controller.start(next => {
        const x = Math.round(next.x);
        const y = Math.round(next.y);
        if (positionRef.current?.x !== x || positionRef.current?.y !== y) {
          positionRef.current = { x, y };
          desktop.movePetWindow(x, y);
        }
        const previous = visualRef.current;
        if (!previous || previous.pose !== next.pose || previous.mood !== next.mood ||
          previous.label !== next.label || previous.flipX !== next.flipX ||
          previous.resting !== next.resting || previous.accessory !== next.accessory) {
          visualRef.current = next;
          setPet(next);
        }
      });
      unsubscribeActivity = desktop.onDesktopActivity(() => controller?.notifyUserActivity());
      desktop.setPetInteractive(false);
    };

    void initialize();
    return () => {
      alive = false;
      unsubscribeActivity?.();
      unsubscribePetOutput?.();
      unsubscribePosition?.();
      controller?.stop();
      controllerRef.current = null;
      positionRef.current = null;
      visualRef.current = null;
      interactiveRef.current = false;
      window.orvixDesktop?.setPetInteractive(false);
    };
  }, []);

  const updatePointerPassThrough = (event: ReactMouseEvent<HTMLDivElement>) => {
    const localX = event.clientX;
    const localY = event.clientY;
    const isPetHitArea = localX >= PET_LEFT - 4 && localX <= PET_LEFT + PET_WIDTH + 32
      && localY >= PET_TOP && localY <= PET_TOP+246;
    setHovered(event.target instanceof Element && Boolean(event.target.closest(".orvix-gpt-pet, .pet-controls")));
    setInteractive(Boolean(dragRef.current) || isPetHitArea || event.target instanceof Element && !!event.target.closest('.pet-speech-caption'));
  };

  const leavePetWindow = () => {
    setHovered(false);
    if (!dragRef.current) setInteractive(false);
  };

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pet || event.button !== 0 || !event.isPrimary || (event.target as HTMLElement).closest(".pet-controls, .pet-speech-caption")) return;
    const controller = controllerRef.current;
    const bounds = desktopBoundsRef.current;
    const position = positionRef.current;
    if (!controller || !bounds || !position) return;
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.screenX - bounds.x - position.x,
      offsetY: event.screenY - bounds.y - position.y,
    };
    controller.beginDrag();
    setInteractive(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const bounds = desktopBoundsRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !bounds) return;
    const x = event.screenX - bounds.x - drag.offsetX;
    const y = event.screenY - bounds.y - drag.offsetY;
    controllerRef.current?.setRawPosition(x, y);
  };

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    controllerRef.current?.endDrag();
    updatePointerPassThrough(event);
  };

  return (
    <div ref={rootRef} className="desktop-pet-root" onMouseMove={updatePointerPassThrough} onMouseLeave={leavePetWindow} onPointerMove={moveDrag} onPointerDown={beginDrag} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
      {liveOutput.trim() && <section className={`pet-speech-caption${isSpeaking?' is-speaking':''}`} aria-label="Orvix speech captions" onPointerDown={event=>event.stopPropagation()}>
        <div ref={captionRef} className="pet-speech-text" dir="auto" onScroll={event=>{const el=event.currentTarget;followCaptionRef.current=el.scrollHeight-el.clientHeight-el.scrollTop<24;}}>{liveOutput}</div>
      </section>}
      {pet && <div className={`desktop-pet-anchor${hovered ? " is-hovered" : ""}`}>
        <OrvixPet mood={pet.mood} pose={pet.pose} label="" hideLabel isSpeaking={isSpeaking} flipX={pet.flipX} accessory={pet.accessory} />
        <div className="pet-controls" role="toolbar" aria-label="Pet controls" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
          <button type="button" aria-label={locked ? "Unlock pet movement" : "Lock pet position"} title={locked ? "Unlock movement" : "Lock position"} aria-pressed={locked} onClick={() => { const next = !locked; setLocked(next); controllerRef.current?.setLocked(next); }}>{locked ? <Lock size={15} /> : <LockKeyholeOpen size={15} />}</button>
          <button type="button" aria-label="Return pet to its corner" title="Return to corner" onClick={() => controllerRef.current?.returnHome()}><Home size={15} /></button>
          <button type="button" aria-label={paused ? "Wake pet" : "Let pet rest"} title={paused ? "Wake" : "Rest"} aria-pressed={paused} onClick={() => { const next = !paused; setPaused(next); controllerRef.current?.setPaused(next); }}>{paused ? <Play size={15} /> : <Pause size={15} />}</button>
        </div>
      </div>}
    </div>
  );
}
