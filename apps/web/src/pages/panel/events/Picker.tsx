import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useI18n } from "../../../i18n/I18nProvider";
import { Ic } from "./common";

export type Option = { value: string; text: string; sub?: string; group?: string };

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * A select with a search box: a button that drops a listbox under the field (a bottom sheet on phones).
 * Keyboard: Enter/Space/ArrowDown on the button opens; in the search box arrows, Home, End move,
 * Enter picks, Esc closes and returns focus to the button, Tab closes without changing anything.
 */
export default function Picker({
  id,
  labelledBy,
  describedBy,
  invalid,
  value,
  display,
  getOptions,
  searchLabel,
  onPick,
  onClose,
  searchText,
}: {
  id: string;
  labelledBy: string;
  describedBy: string;
  invalid: boolean;
  value: string;
  display: ReactNode;
  /** Built when the list opens (the time zone list is large and its offsets are not free to compute). */
  getOptions: () => Option[];
  searchLabel: string;
  onPick: (v: string) => void;
  /** Called when the list closes (the field counts as touched). */
  onClose?: () => void;
  /** What the search matches against, besides the visible text. */
  searchText?: (o: Option) => string;
}) {
  const { t } = useI18n();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Option[]>([]);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const shown = useMemo(() => {
    const n = fold(q.trim());
    if (!n) return options;
    return options.filter((o) => fold(`${o.text} ${o.sub ?? ""} ${searchText?.(o) ?? ""}`).includes(n) && o.group !== "pinned");
  }, [options, q, searchText]);

  const openList = () => {
    const opts = getOptions();
    const i = opts.findIndex((o) => o.value === value);
    setOptions(opts);
    setQ("");
    setActive(Math.max(0, i));
    setOpen(true);
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    onClose?.();
    if (refocus) trigger.current?.focus();
  };
  const pick = (v: string) => {
    onPick(v);
    close(true);
  };

  useEffect(() => {
    if (open) search.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, open, shown]);

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const last = shown.length - 1;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(last, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(Math.max(0, last));
    } else if (e.key === "Enter") {
      e.preventDefault(); // never submits the form
      const o = shown[active];
      if (o) pick(o.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") {
      setOpen(false);
      onClose?.();
    }
  };

  const hasPinned = options.some((o) => o.group === "pinned");
  let lastGroup: string | undefined;
  return (
    <div className="pe-pickwrap" ref={root}>
      <button
        ref={trigger}
        type="button"
        id={id}
        className="pe-pick"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${labelledBy} ${id}`}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        onClick={() => (open ? close(true) : openList())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!open) openList();
          }
        }}
      >
        {display}
        <Ic n="chev" />
      </button>
      {open && (
        <div className="pe-popscrim" aria-hidden="true" />
      )}
      {open && (
        <div className="pe-pop" role="dialog" aria-label={searchLabel}>
          <div className="pe-pksearch">
            <Ic n="search" size={18} />
            <input
              ref={search}
              className="pe-inp"
              role="combobox"
              aria-expanded="true"
              aria-controls={`${uid}-list`}
              aria-autocomplete="list"
              aria-activedescendant={shown[active] ? `${uid}-o${active}` : undefined}
              autoComplete="off"
              spellCheck={false}
              placeholder={searchLabel}
              aria-label={searchLabel}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              onKeyDown={onSearchKey}
            />
          </div>
          <ul ref={list} className="pe-pklist" id={`${uid}-list`} role="listbox" aria-label={searchLabel}>
            {shown.length === 0 && <li className="pe-pkempty" role="presentation">{t("peNoResults", { q: q.trim() })}</li>}
            {shown.map((o, i) => {
              const head = hasPinned && o.group !== lastGroup ? o.group : undefined;
              lastGroup = o.group;
              return (
                <li key={`${o.group ?? ""}:${o.value}`} role="presentation">
                  {head && !q.trim() && <p className="pe-pkl" role="presentation">{head === "pinned" ? t("peDetected") : t("peAll")}</p>}
                  <div
                    role="option"
                    id={`${uid}-o${i}`}
                    data-i={i}
                    className={`pe-opt${i === active ? " act" : ""}`}
                    aria-selected={o.value === value}
                    onMouseMove={() => active !== i && setActive(i)}
                    onClick={() => pick(o.value)}
                  >
                    <span className="v" dir="auto">
                      {o.text}
                      {o.sub && <small>{o.sub}</small>}
                    </span>
                    {o.value === value && <Ic n="check" size={18} />}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
