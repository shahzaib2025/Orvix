# Lenis smooth-scrolling integration

Use when the chosen MAX motion stack uses Lenis. This skill describes scroll integration and lifecycle only; it does not choose a visual concept, prescribe a page structure, or provide a design template. Read `gsap` and `scrolltrigger` too when combining Lenis with GSAP scroll animation.

## Decide whether and how to use it

Inspect the target website's actual runtime and version before setup. Install/import Lenis in that website project with its existing package manager and lockfile; do not add it to Orvix itself. Use the current official stylesheet and API expected by the installed version. Keep native browser scrolling understandable and usable. Do not disable touch behavior or replace browser scroll semantics without a subject-specific reason and observed usability.

Distinguish the constructor from its instance: the documented API is `new Lenis(...)`, commonly assigned to a lowercase variable such as `lenis`. For the classic browser bundle, verify the actual exported global (`window.Lenis` in the documented bundle), rather than testing or constructing `window.lenis`. A wrong symbol can silently trigger a static fallback while the library loaded successfully. Check the constructor, created instance, ticker and live ScrollTriggers in the browser before declaring a remote-library failure or successful integration.

Use one Lenis instance per scrolling experience and a single coherent animation clock. For the documented GSAP integration, connect Lenis scroll events to `ScrollTrigger.update()` and drive `lenis.raf(time * 1000)` from one named callback on GSAP's ticker. GSAP ticker time is in seconds; Lenis RAF time is in milliseconds. Do not also enable Lenis `autoRaf` or create a separate RAF loop for the same instance. Follow the installed Lenis version's current guidance on ticker lag smoothing rather than copying a setting from an old example. Do not add ScrollSmoother or another smooth-scroll replacement alongside Lenis.

## Preserve navigation and clean up

Check native anchor navigation, browser history, fixed-header offsets, keyboard use, touch, and nested scrolling. Dialogs, menus, and independently scrollable panels may need their own deliberate handling so page smooth scrolling does not trap or steal their input. Keep Lenis and ScrollTrigger pointed at the same real scrolling context.

On teardown or when reduced motion changes, remove the exact named GSAP ticker callback and the original Lenis event callbacks before destroying/clearing the instance. Remove anchor or DOM listeners by their registered function references. Do not leave anonymous ticker wrappers that continue calling a destroyed instance, and do not create a second callback when motion is re-enabled. Do not remove other components' shared ticker work.

Honor reduced-motion changes at startup and runtime. Keep a stable native-scroll or otherwise accessible settled state when smoothing is disabled. Verify keyboard anchors, forward/back navigation, mobile touch, dialog scroll, and a runtime reduced-motion switch as applicable. Check console output for destroyed-instance or duplicate-listener errors after transitions. Consult the current [official Lenis documentation](https://github.com/darkroomengineering/lenis) and its GSAP integration for version-specific setup.
