// A dropdown that, unlike <select>, shows an icon beside each option: a
// button that opens a listbox. It behaves like a select for the page: a
// `value` (the chosen option's, "" for none) and a "change" event when the
// user picks one. Keyboard: arrows, Home, End, Enter, Escape. Icons load
// lazily, as they scroll into view (a list can hold thousands).
export class ItemList extends EventTarget {
  constructor(host, label) {
    super();
    this.host = host;
    this.options = [];
    this.placeholder = "";
    this._value = "";
    this.active = -1;
    this.button = Object.assign(document.createElement("button"), { type: "button", className: "ff-input ff-list-button" });
    this.button.setAttribute("aria-haspopup", "listbox");
    this.button.setAttribute("aria-expanded", "false");
    this.button.setAttribute("aria-label", label);
    this.list = Object.assign(document.createElement("ul"), { className: "ff-list-box", tabIndex: -1, hidden: true });
    this.list.setAttribute("role", "listbox");
    this.list.setAttribute("aria-label", label);
    host.replaceChildren(this.button, this.list);

    this.button.addEventListener("click", () => (this.list.hidden ? this.open() : this.close()));
    this.button.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); this.open(); }
    });
    this.list.addEventListener("keydown", (e) => this.key(e));
    this.list.addEventListener("click", (e) => {
      const li = e.target.closest("li[data-value]");
      if (li) this.choose(li.dataset.value);
    });
    document.addEventListener("pointerdown", (e) => { if (!host.contains(e.target)) this.close(false); });
  }

  // options: [{ value, label, icon (URL or null), title }]
  setOptions(placeholder, options) {
    this.placeholder = placeholder;
    this.options = options;
    this._value = "";
    this.close(false);
    this.render();
  }

  get value() { return this._value; }
  set value(v) {
    this._value = String(v);
    this.render();
  }

  item(o) {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    li.id = `${this.host.id}-o${o.value}`;
    li.dataset.value = o.value;
    li.title = o.title || o.label;
    const icon = document.createElement(o.icon ? "img" : "span");
    icon.className = "ff-list-icon";
    if (o.icon) Object.assign(icon, { src: o.icon, alt: "", loading: "lazy", decoding: "async" });
    li.append(icon, Object.assign(document.createElement("span"), { textContent: o.label }));
    return li;
  }

  render() {
    const chosen = this.options.find((o) => String(o.value) === this._value);
    this.button.replaceChildren(...(chosen ? this.item(chosen).childNodes : [Object.assign(document.createElement("span"), { textContent: this.placeholder })]));
    this.button.disabled = !this.options.length;
  }

  open() {
    if (!this.options.length || !this.list.hidden) return;
    this.list.replaceChildren(...this.options.map((o) => this.item(o)));
    this.list.hidden = false;
    this.button.setAttribute("aria-expanded", "true");
    const i = this.options.findIndex((o) => String(o.value) === this._value);
    this.move(i < 0 ? 0 : i);
    this.list.focus();
  }

  close(focus = true) {
    if (this.list.hidden) return;
    this.list.hidden = true;
    this.list.replaceChildren();
    this.button.setAttribute("aria-expanded", "false");
    if (focus) this.button.focus();
  }

  move(i) {
    const items = this.list.children;
    if (!items.length) return;
    this.active = Math.max(0, Math.min(items.length - 1, i));
    for (const li of items) li.classList.remove("active");
    const li = items[this.active];
    li.classList.add("active");
    li.scrollIntoView({ block: "nearest" });
    this.list.setAttribute("aria-activedescendant", li.id);
  }

  key(e) {
    const page = 10;
    if (e.key === "ArrowDown") this.move(this.active + 1);
    else if (e.key === "ArrowUp") this.move(this.active - 1);
    else if (e.key === "PageDown") this.move(this.active + page);
    else if (e.key === "PageUp") this.move(this.active - page);
    else if (e.key === "Home") this.move(0);
    else if (e.key === "End") this.move(this.options.length - 1);
    else if (e.key === "Enter" || e.key === " ") { if (this.options[this.active]) this.choose(this.options[this.active].value); }
    else if (e.key === "Escape" || e.key === "Tab") { this.close(e.key === "Escape"); return; }
    else return;
    e.preventDefault();
  }

  choose(v) {
    this.value = v;
    this.close();
    this.dispatchEvent(new Event("change"));
  }
}
