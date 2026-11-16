// Inline SVG (not <img>) so the --tile-* tokens follow the app theme. Decorative: hidden from AT.
// Source: design/assets/home/trail-tile.svg
export function HomeTrailTile({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 84 84" aria-hidden="true" focusable="false">
<rect width="84" height="84" fill="var(--tile-ground, #DDE8C4)"/>
<path d="M-1 -1H27C25 8 15 15 -1 16Z" fill="var(--tile-water, #A9D4E6)"/>
<path d="M-6 27C20 25 40 30 90 24" stroke="var(--tile-road, #F3E6C8)" strokeWidth="7" fill="none"/>
<path d="M-6 66.5H26.5L38.5 64.5L48.5 57.5L55.5 48.5L61.5 40.5L65 32L71 -6" stroke="var(--tile-road, #F3E6C8)" strokeWidth="13" fill="none" strokeLinejoin="round"/>
<g fill="var(--tile-block, #F2B8A0)"><rect x="30" y="36" width="13" height="10" rx="2"/><rect x="5" y="39" width="12" height="9" rx="2"/><rect x="62" y="62" width="13" height="10" rx="2"/><rect x="44" y="75" width="13" height="8" rx="2"/></g>
<g fill="var(--tile-tree, #9CC28A)"><circle cx="77" cy="50" r="4"/><circle cx="33" cy="79" r="4"/><circle cx="21" cy="47" r="3.5"/><circle cx="8" cy="79" r="3.5"/></g>

<circle cx="13" cy="66" r="9" fill="var(--ink, #1E2340)" opacity=".16"/>
<g shapeRendering="crispEdges">
  <g fill="var(--tile-shadow, rgba(30,35,64,.3))"><rect x="24" y="64" width="7" height="7"/><rect x="36" y="62" width="7" height="7"/><rect x="46" y="55" width="7" height="7"/><rect x="53" y="46" width="7" height="7"/><rect x="59" y="38" width="7" height="7"/></g>
  <g fill="var(--em, #E2532A)"><rect x="23" y="63" width="7" height="7"/><rect x="35" y="61" width="7" height="7"/><rect x="45" y="54" width="7" height="7"/><rect x="52" y="45" width="7" height="7"/><rect x="58" y="37" width="7" height="7"/></g>
</g>
<circle cx="13" cy="66" r="4.5" fill="var(--ink, #1E2340)" stroke="var(--surface, #FFFFFF)" strokeWidth="2"/>

<g transform="translate(50.8 4) scale(.6)"><g fill="#FFFFFF" stroke="#FFFFFF" strokeWidth="3" strokeLinejoin="round"><path d="M15 38 L22 50 L29 38 Z"/><circle cx="22" cy="21" r="20"/></g><g fill="#FF6A3D"><path d="M15 38 L22 50 L29 38 Z"/><circle cx="22" cy="21" r="20"/></g><g fill="#1E2340" shapeRendering="crispEdges"><rect x="22" y="9" width="3" height="3"/><rect x="25" y="9" width="3" height="3"/><rect x="28" y="9" width="3" height="3"/><rect x="22" y="12" width="3" height="3"/><rect x="28" y="12" width="3" height="3"/><rect x="31" y="12" width="3" height="3"/><rect x="22" y="15" width="3" height="3"/><rect x="22" y="18" width="3" height="3"/><rect x="16" y="21" width="3" height="3"/><rect x="19" y="21" width="3" height="3"/><rect x="22" y="21" width="3" height="3"/><rect x="13" y="24" width="3" height="3"/><rect x="16" y="24" width="3" height="3"/><rect x="19" y="24" width="3" height="3"/><rect x="22" y="24" width="3" height="3"/><rect x="13" y="27" width="3" height="3"/><rect x="16" y="27" width="3" height="3"/><rect x="19" y="27" width="3" height="3"/><rect x="22" y="27" width="3" height="3"/><rect x="16" y="30" width="3" height="3"/><rect x="19" y="30" width="3" height="3"/></g></g>

    </svg>
  );
}
