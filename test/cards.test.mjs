/* Renders cards from a many-optional-fields row and reports the card's shape. */
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..") + "/";

// index.html is stored with CRLF; normalise so the extraction patterns match.
const html = fs.readFileSync(ROOT + "index.html", "utf8").split("\r\n").join("\n");

class N {
  constructor(t){ this.tag=t; this.children=[]; this.attrs={}; this._text=""; this.className=""; }
  appendChild(c){ this.children.push(c); return c; }
  setAttribute(k,v){ this.attrs[k]=v; }
  set href(v){ this.attrs.href=v; }
  set title(v){ this.attrs.title=v; }
  set open(v){ if (v) this.attrs.open="open"; }
  set src(v){ this.attrs.src=v; }
  set alt(v){} set loading(v){} set onerror(v){}
  set textContent(v){ this._text=String(v); this.children=[]; }
  get textContent(){ return this._text + this.children.map(c=>c.textContent||"").join(""); }
  get outer(){
    const cls = this.className ? ` class="${this.className}"` : "";
    const at = Object.entries(this.attrs).map(([k,v])=>` ${k}="${v}"`).join("");
    const kids = this.children.map(c => c.outer !== undefined ? c.outer : c.textContent).join("");
    return `<${this.tag}${cls}${at}>${this._text}${kids}</${this.tag}>`;
  }
}
globalThis.document = {
  createElement: t => new N(t),
  createElementNS: (_n,t) => new N(t),
  createTextNode: t => ({ textContent:String(t), outer:String(t) })
};

const grab = re => {
  const m = html.match(re);
  if (!m) { console.error("NO MATCH: " + re); process.exit(1); }
  return m[0];
};

const { contact, classify } = new Function([
  grab(/var P = \{[\s\S]*?\n  \};/),
  grab(/function svg\(d, stroke\)[\s\S]*?\n  \}/),
  grab(/function el\(t, c, x\)[\s\S]*?\n  \}/),
  grab(/function initials\(n\)[\s\S]*?\n  \}/),
  grab(/function isUrl\(v\)[\s\S]*?\n/),
  grab(/function tel\(v\)[\s\S]*?\n/),
  grab(/function fileCol\(cols\)[\s\S]*?\n  \}/),
  grab(/function classify\(cols\)[\s\S]*?\n    return r;\n  \}/),
  grab(/function contact\(row, map, sos, term\)[\s\S]*?\n    return c;\n  \}/),
  'function t(k){ return {ownerDetails:"Owner details",moreDetails:"More details",' +
    'call:"Call",email:"Email"}[k] || k; }',
  "return { contact, classify };"
].join("\n"))();

const row = {
  Name:"Anil Kulkarni", Block:"A", Flat:"A-101", Phone:"+91 98330 40011",
  Email:"anil@example.com", Type:"Owner", "Blood Group":"O+",
  "Emergency Contact":"Sunil Kulkarni +91 98220 11111",
  "Vehicle No":"MH-09-AB-1234", "Parking Slot":"P-12", "Vehicle Type":"Car",
  Profession:"Paediatrician", Language:"Marathi", Occupants:"4", Pets:"1 dog"
};
const map = classify(Object.keys(row));

let fails = 0;
const chk = (l,g,e) => {
  const ok = String(g) === String(e);
  if (!ok) fails++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${l.padEnd(46)} ${String(g).slice(0,30)}`);
};

console.log("column roles");
chk("blood group detected", map.blood, "Blood Group");
chk("blood not left in the detail list", map.rest.includes("Blood Group"), false);
chk("only the real phone is a call button", map.phone.join(","), "Phone");
chk("optional fields land in the detail list", map.rest.length >= 6, true);

const out = contact(row, map, false, "").outer;
const visible = out.split('class="mbody"')[0];
const folded = out.split('class="mbody"')[1] || "";

console.log("\ncard shape, no search");
chk("blood badge rendered", /class="blood">O\+</.test(out), true);
chk("visible lines = 1 location + 2 details", (visible.match(/class="cdet"/g)||[]).length, 3);
chk("the rest are folded away", (folded.match(/class="cdet"/g)||[]).length >= 4, true);
chk("a More disclosure exists", /<details class="more"/.test(out), true);
chk("it is closed by default", /<details class="more" open/.test(out), false);
chk("the count is in the summary", /More details \(\d+\)/.test(out), true);
chk("folded values are still in the page", out.includes("MH-09-AB-1234"), true);

console.log("\nwhen a search matches a folded field");
chk("More opens automatically", /<details class="more" open/.test(
  contact(row, map, false, "paediatrician").outer), true);
chk("and stays closed otherwise", /<details class="more" open/.test(
  contact(row, map, false, "anil").outer), false);

const sparse = { Name:"Ayesha Khan", Block:"C", Flat:"C-304", Phone:"+91 98330 40020",
  Email:"", Type:"Tenant", "Blood Group":"B-", "Emergency Contact":"",
  "Vehicle No":"", "Parking Slot":"", "Vehicle Type":"", Profession:"Architect",
  Language:"", Occupants:"", Pets:"" };
const thin = contact(sparse, map, false, "").outer;

console.log("\nsomeone who answered almost nothing");
chk("blood badge still shown", /class="blood">B-</.test(thin), true);
chk("no empty detail lines", /: <\/b><\/div>/.test(thin), false);
chk("no More button with nothing to fold", /<details class="more"/.test(thin), false);

console.log(fails ? `\n  ${fails} FAILED` : "\n  all checks passed");
process.exit(fails ? 1 : 0);
