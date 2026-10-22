/* =========================================================
   SAMVIDHAN: LEGAL EMPIRE — src/state.js
   Data + persistence + learning engine.
   Exposes:  Samvidhan.util, Samvidhan.DB, Samvidhan.State
   NOTE: Legal content is for learning. Always verify against
   the official bare Acts / Constitution text before relying on it.
   ========================================================= */
(function (global) {
'use strict';

const SV = global.Samvidhan = global.Samvidhan || {};

/* ---------------------------------------------------------
   UTILITIES
   --------------------------------------------------------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function pick(arr, rnd) { return arr[Math.floor((rnd || Math.random)() * arr.length)]; }
function shuffle(arr, rnd) {
  const a = arr.slice(); const r = rnd || Math.random;
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
function dayKey(offset) {
  const d = new Date(); d.setDate(d.getDate() + (offset || 0));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function deepMerge(base, over) {
  if (base === null || typeof base !== 'object' || Array.isArray(base)) return over === undefined ? base : over;
  const out = Object.assign({}, base);
  if (over && typeof over === 'object') {
    for (const k of Object.keys(over)) {
      if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) out[k] = deepMerge(base[k], over[k]);
      else out[k] = over[k];
    }
  }
  return out;
}
SV.util = { mulberry32, clamp, pick, shuffle, dayKey, hashStr, deepMerge };

/* ---------------------------------------------------------
   CONFIG: STYLES, CIRCUITS, RANKS, ROOMS
   Stats: power(Legal Power) flow(Argument Flow) recall(Precedent Recall)
          fortitude(Mental Fortitude). maxHealth = 60 + fortitude, maxFlow = 60 + flow
   --------------------------------------------------------- */
const STYLES = {
  balanced: { label: 'All-Rounder', stats: { power: 44, flow: 44, recall: 44, fortitude: 44 } },
  orator:   { label: 'Orator',      stats: { power: 38, flow: 58, recall: 42, fortitude: 42 } },
  scholar:  { label: 'Scholar',     stats: { power: 36, flow: 42, recall: 58, fortitude: 44 } },
  fighter:  { label: 'Litigator',   stats: { power: 58, flow: 42, recall: 38, fortitude: 46 } }
};

const CIRCUITS = [
  { id: 0, name: 'Taluk Court',            short: 'TALUK',    repReq: 0,   masteryReq: 0,  feeMin: 500,    feeMax: 2000,   repBase: 12, judge: 'Civil Judge',          room: 'Taluk Civil & Criminal Court' },
  { id: 1, name: 'District Sessions Court', short: 'DISTRICT', repReq: 100, masteryReq: 6,  feeMin: 3000,   feeMax: 12000,  repBase: 25, judge: 'Sessions Judge',       room: 'District Sessions Courtroom' },
  { id: 2, name: 'State High Court',        short: 'HIGH COURT', repReq: 350, masteryReq: 16, feeMin: 15000,  feeMax: 60000,  repBase: 45, judge: 'Justice (High Court)', room: 'High Court Chambers' },
  { id: 3, name: 'Supreme Court of India',  short: 'SUPREME',  repReq: 800, masteryReq: 32, feeMin: 75000,  feeMax: 300000, repBase: 80, judge: 'Justice (Supreme Court)', room: 'Supreme Court Chambers' }
];

const RANKS = [
  { min: 0,    title: 'Junior Advocate' },
  { min: 50,   title: 'Advocate' },
  { min: 200,  title: 'Senior Litigator' },
  { min: 450,  title: 'Standing Counsel' },
  { min: 900,  title: 'Senior Advocate' },
  { min: 1500, title: 'Legal Legend' }
];

const ROOMS = {
  courtroom: { name: 'District Sessions Courtroom',        minCircuit: 0 },
  library:   { name: "Advocates' Bar Library",             minCircuit: 0 },
  thana:     { name: 'Police Thana & Lockup',              minCircuit: 0 },
  chambers:  { name: 'High Court & Supreme Court Chambers', minCircuit: 2 }
};

/* Core Constitutional Moves: stick direction + G */
const MOVES = {
  up:    { dir: 'up',    kind: 'article', ref: '21',     name: 'Article 21',    sub: 'Right to Life & Personal Liberty', type: 'defence', power: 1.4, cost: 22, callout: 'ARTICLE 21!' },
  down:  { dir: 'down',  kind: 'writ',    ref: 'habeas', name: 'Habeas Corpus', sub: 'Breaks illegal detention',          type: 'break',   power: 1.0, cost: 26, callout: 'HABEAS CORPUS!' },
  left:  { dir: 'left',  kind: 'article', ref: '14',     name: 'Article 14',    sub: 'Right to Equality',                 type: 'rebut',   power: 1.1, cost: 18, callout: 'ARTICLE 14!' },
  right: { dir: 'right', kind: 'article', ref: '19',     name: 'Article 19',    sub: 'Freedom of Speech',                 type: 'counter', power: 1.2, cost: 20, callout: 'ARTICLE 19!' }
};

/* ---------------------------------------------------------
   DATABASE: PARTS OF THE CONSTITUTION
   --------------------------------------------------------- */
const PARTS = [
  { id: 'PRE', title: 'Preamble',                                   range: 'Preamble' },
  { id: 'I',   title: 'The Union and its Territory',                range: 'Arts 1–4' },
  { id: 'II',  title: 'Citizenship',                                range: 'Arts 5–11' },
  { id: 'III', title: 'Fundamental Rights',                         range: 'Arts 12–35' },
  { id: 'IV',  title: 'Directive Principles of State Policy',       range: 'Arts 36–51' },
  { id: 'IVA', title: 'Fundamental Duties',                         range: 'Art 51A' },
  { id: 'V',   title: 'The Union',                                  range: 'Arts 52–151', chapters: 'Executive; Parliament; Legislative Powers of the President; Union Judiciary; CAG' },
  { id: 'VI',  title: 'The States',                                 range: 'Arts 152–237', chapters: 'Executive; Legislature; Governor’s legislative power; High Courts; Subordinate Courts' },
  { id: 'VIII', title: 'The Union Territories',                     range: 'Arts 239–242' },
  { id: 'IX',  title: 'The Panchayats',                             range: 'Arts 243–243O' },
  { id: 'IXA', title: 'The Municipalities',                         range: 'Arts 243P–243ZG' },
  { id: 'IXB', title: 'Co-operative Societies',                     range: 'Arts 243ZH–243ZT' },
  { id: 'X',   title: 'Scheduled and Tribal Areas',                 range: 'Arts 244–244A' },
  { id: 'XI',  title: 'Relations between the Union and the States', range: 'Arts 245–263' },
  { id: 'XII', title: 'Finance, Property, Contracts and Suits',     range: 'Arts 264–300A' },
  { id: 'XIII', title: 'Trade, Commerce and Intercourse',           range: 'Arts 301–307' },
  { id: 'XIV', title: 'Services under the Union and the States',    range: 'Arts 308–323' },
  { id: 'XIVA', title: 'Tribunals',                                 range: 'Arts 323A–323B' },
  { id: 'XV',  title: 'Elections',                                  range: 'Arts 324–329A' },
  { id: 'XVI', title: 'Special Provisions for Certain Classes',     range: 'Arts 330–342A' },
  { id: 'XVII', title: 'Official Language',                         range: 'Arts 343–351' },
  { id: 'XVIII', title: 'Emergency Provisions',                     range: 'Arts 352–360' },
  { id: 'XIX', title: 'Miscellaneous',                              range: 'Arts 361–367' },
  { id: 'XX',  title: 'Amendment of the Constitution',              range: 'Art 368' },
  { id: 'XXI', title: 'Temporary, Transitional and Special Provisions', range: 'Arts 369–392' },
  { id: 'XXII', title: 'Short Title, Commencement, Hindi Text, Repeals', range: 'Arts 393–395' }
];

/* ---------------------------------------------------------
   DATABASE: ARTICLES  (n, part, title, easy summary, memory tip, tier)
   --------------------------------------------------------- */
const A = (n, part, title, summary, tip, tier) => ({ n: String(n), part, title, summary, tip, tier: tier || 0 });
const ARTICLES = [
  A('PRE', 'PRE', 'The Preamble', 'Opens with "We, the People of India" and declares India a Sovereign, Socialist, Secular, Democratic Republic securing Justice, Liberty, Equality and Fraternity.', 'SSSDR + JLEF. "Socialist" and "Secular" were added in 1976 (42nd Amendment).', 0),
  A(12, 'III', "Definition of 'State'", "Defines 'State' for Part III: Government and Parliament, State legislatures, and local or other authorities.", 'Fundamental Rights bind the STATE.', 1),
  A(13, 'III', 'Laws inconsistent with Fundamental Rights', 'Any law that violates Fundamental Rights is void to that extent. Basis of judicial review.', 'Bad law + Part III = void.', 1),
  A(14, 'III', 'Equality before law', 'Everyone is equal before the law and has equal protection of the laws. Arbitrary state action violates it.', '14 = Everyone is on the same level.', 0),
  A(15, 'III', 'No discrimination', 'The State cannot discriminate on grounds of religion, race, caste, sex or place of birth. Special provisions for women, children and backward classes are allowed.', 'Five grounds: RRCSP.', 1),
  A(16, 'III', 'Equality in public employment', 'Equal opportunity in government jobs; reservation for backward classes is permitted.', '16 = Jobs for all (fairly).', 0),
  A(17, 'III', 'Abolition of Untouchability', 'Untouchability is abolished and its practice in any form is forbidden and punishable.', '17 = Untouchability ends.', 0),
  A(18, 'III', 'Abolition of titles', 'The State cannot confer titles (other than military or academic distinctions).', 'No "Raja" or "Rai Bahadur" from the State.', 1),
  A(19, 'III', 'Protection of six freedoms', 'Speech and expression, peaceful assembly, forming associations, moving freely, residing anywhere in India, and practising any profession or trade, subject to reasonable restrictions.', 'Speak, Assemble, Associate, Move, Reside, Occupation.', 0),
  A(20, 'III', 'Protection in respect of conviction for offences', 'No retrospective criminal laws, no double jeopardy, and no forced self-incrimination.', 'Three shields: Past, Twice, Self.', 0),
  A(21, 'III', 'Protection of life and personal liberty', 'No one can be deprived of life or personal liberty except by procedure established by law. Courts read in dignity, privacy, speedy trial, legal aid and a clean environment.', '21 = the widest, most-used right.', 0),
  A('21A', 'III', 'Right to education', 'Free and compulsory education for children aged 6 to 14 years (added by the 86th Amendment, 2002).', '21A = Age 6–14 schooling.', 0),
  A(22, 'III', 'Safeguards on arrest and detention', 'An arrested person must be told the grounds, can consult a lawyer of choice and must be produced before a Magistrate within 24 hours. Preventive detention has separate rules.', '22 = 24-hour rule.', 0),
  A(23, 'III', 'Ban on trafficking and forced labour', 'Prohibits human trafficking, begar and other forced labour.', '23 = No bonded labour.', 0),
  A(24, 'III', 'No child labour in hazardous work', 'Children below 14 cannot be employed in factories, mines or other hazardous work.', '24 = Under 14, no danger jobs.', 0),
  A(25, 'III', 'Freedom of religion', 'Freedom of conscience and the right to profess, practise and propagate religion, subject to public order, morality and health.', '25 = Individual faith.', 0),
  A(26, 'III', 'Freedom to manage religious affairs', 'Religious denominations can manage their own religious affairs and hold property.', '26 = Group faith.', 1),
  A(27, 'III', 'No compulsory religious taxes', 'No one can be forced to pay taxes for promoting a particular religion.', '27 = No religion tax.', 1),
  A(28, 'III', 'Religious instruction in schools', 'Limits religious instruction in State-funded educational institutions.', '28 = Schools and religion.', 1),
  A(29, 'III', 'Protection of minority interests', 'Any section of citizens with a distinct language, script or culture can conserve it.', '29 = Culture safe.', 1),
  A(30, 'III', 'Minority educational institutions', 'Minorities, based on religion or language, can establish and administer educational institutions of their choice.', '30 = Minority schools.', 0),
  A(32, 'III', 'Right to constitutional remedies', 'The right to move the Supreme Court directly to enforce Fundamental Rights. Dr. B.R. Ambedkar called it the "heart and soul" of the Constitution.', '32 = Supreme Court directly.', 2),
  A(37, 'IV', 'Application of Directive Principles', 'Directive Principles are not enforceable by courts but are fundamental in the governance of the country.', 'Guiding, not binding.', 1),
  A(38, 'IV', 'State to secure a social order for welfare', 'The State should promote the welfare of the people and reduce inequalities of income, status and opportunity.', '38 = Welfare state.', 1),
  A(39, 'IV', 'Certain principles of policy', 'Adequate livelihood, equal pay for equal work for men and women (39(d)), and protection of children from abuse.', '39(d) = Equal pay.', 1),
  A('39A', 'IV', 'Equal justice and free legal aid', 'The State must ensure that justice is not denied by economic or other disabilities, and provide free legal aid.', '39A = A for Aid.', 1),
  A(40, 'IV', 'Organisation of village panchayats', 'The State should organise village panchayats as units of self-government.', '40 = Panchayats.', 1),
  A(44, 'IV', 'Uniform Civil Code', 'The State shall endeavour to secure a Uniform Civil Code for citizens across India.', '44 = Common civil law.', 1),
  A(45, 'IV', 'Early childhood care and education', 'Care and education for all children until they complete the age of six.', '45 = Below 6.', 2),
  A(47, 'IV', 'Nutrition, public health and prohibition', 'The State should raise nutrition levels and public health, and work towards prohibiting harmful intoxicants.', '47 = Health first.', 2),
  A('48A', 'IV', 'Protection of environment', 'The State shall protect and improve the environment and safeguard forests and wildlife.', '48A = Green.', 2),
  A(50, 'IV', 'Separation of judiciary from executive', 'The State shall take steps to separate the judiciary from the executive in public services.', '50 = Fifty-fifty: judges apart from government.', 2),
  A(51, 'IV', 'Promotion of international peace', 'India shall promote international peace and respect for international law.', '51 = Peace.', 2),
  A('51A', 'IVA', 'Fundamental Duties', 'Eleven duties of citizens including respecting the Constitution, flag and anthem, protecting the environment, developing scientific temper, and (parents) educating children aged 6–14.', 'Added in 1976 by the 42nd Amendment.', 1),
  A(52, 'V', 'The President of India', 'There shall be a President of India.', 'Head of State.', 1),
  A(72, 'V', 'Power of the President to grant pardons', 'The President can grant pardons, reprieves, respites or remissions, and suspend, remit or commute sentences, including death sentences.', '72 = President’s mercy.', 3),
  A(74, 'V', 'Council of Ministers', 'A Council of Ministers headed by the Prime Minister aids and advises the President, who acts on that advice.', '74 = Advice binds.', 2),
  A(79, 'V', 'Constitution of Parliament', 'Parliament consists of the President, the Rajya Sabha and the Lok Sabha.', 'Three parts.', 1),
  A(110, 'V', 'Money Bill', 'Defines Money Bills, which can be introduced only in the Lok Sabha.', '110 = Money, Lok Sabha only.', 2),
  A(123, 'V', 'Ordinance-making power of the President', 'When Parliament is not in session, the President can promulgate ordinances with the force of law.', '123 = Ordinance by President.', 2),
  A(124, 'V', 'Establishment of the Supreme Court', 'Establishes the Supreme Court of India and provides for appointment of its judges.', '124 = Supreme Court begins.', 2),
  A(129, 'V', 'Supreme Court as a court of record', 'The Supreme Court is a court of record and has power to punish for its contempt.', '129 = Record + Contempt.', 3),
  A(136, 'V', 'Special Leave to Appeal', 'The Supreme Court may grant special leave to appeal from almost any court or tribunal in India (SLP).', '136 = SLP.', 2),
  A(141, 'V', 'Law declared by the Supreme Court', 'The law declared by the Supreme Court is binding on all courts in India.', '141 = Precedent binds.', 2),
  A(142, 'V', 'Enforcement of decrees: complete justice', 'The Supreme Court can pass any order necessary to do complete justice in any matter before it.', '142 = Complete justice.', 3),
  A(163, 'VI', 'Council of Ministers for the Governor', 'A Council of Ministers aids and advises the Governor of a State.', 'State version of Art 74.', 2),
  A(214, 'VI', 'High Courts for States', 'There shall be a High Court for each State.', '214 = HC for each State.', 2),
  A(215, 'VI', 'High Courts as courts of record', 'Every High Court is a court of record and can punish for its contempt.', '215 = HC record.', 3),
  A(226, 'VI', 'Power of High Courts to issue writs', 'High Courts can issue writs for enforcing Fundamental Rights and for any other legal right.', '226 = HC writ, wider than 32.', 1),
  A(227, 'VI', 'Superintendence over subordinate courts', 'Every High Court supervises all courts and tribunals within its territory.', '227 = HC supervises lower courts.', 2),
  A(245, 'XI', 'Extent of laws made by Parliament and States', 'Parliament can make laws for all or part of India; State legislatures for their State.', '245 = Territory of laws.', 2),
  A(246, 'XI', 'Subject-matter of laws: the Three Lists', 'Divides legislative powers into the Union List, State List and Concurrent List (Seventh Schedule).', '246 = Union, State, Concurrent.', 2),
  A(265, 'XII', 'Taxes only by authority of law', 'No tax can be levied or collected except by authority of law.', '265 = No tax without law.', 2),
  A('300A', 'XII', 'Right to property', 'No person can be deprived of property except by authority of law. Since 1978 (44th Amendment) it is a constitutional right, not a Fundamental Right.', '300A = Property, no longer in Part III.', 1),
  A(311, 'XIV', 'Safeguards for civil servants', 'Civil servants cannot be dismissed or reduced in rank without an inquiry giving a reasonable opportunity to be heard.', '311 = Hear before you fire.', 2),
  A(324, 'XV', 'Election Commission', 'Superintendence, direction and control of elections vest in the Election Commission of India.', '324 = Election umpire.', 1),
  A(326, 'XV', 'Adult suffrage', 'Elections to the Lok Sabha and State assemblies are on the basis of adult suffrage; voting age is 18 (61st Amendment).', '326 = Vote at 18.', 1),
  A(352, 'XVIII', 'Proclamation of Emergency', 'The President can proclaim a national emergency on grounds of war, external aggression or armed rebellion.', '352 = National Emergency.', 3),
  A(356, 'XVIII', 'Failure of constitutional machinery in States', 'The President can assume State governance when the State government cannot function per the Constitution (President’s Rule).', '356 = President’s Rule.', 3),
  A(360, 'XVIII', 'Financial Emergency', 'The President can proclaim a financial emergency if the financial stability of India is threatened.', '360 = Money crisis.', 3),
  A(368, 'XX', 'Power to amend the Constitution', 'Parliament can amend the Constitution by the procedure laid down here, but cannot alter its basic structure (Kesavananda Bharati).', '368 = Amend, but not the basic structure.', 3)
];

/* ---------------------------------------------------------
   DATABASE: WRITS
   --------------------------------------------------------- */
const WRITS = [
  { id: 'habeas',     name: 'Habeas Corpus',  latin: '"You may have the body"', use: 'Orders the production of a detained person before the court to test whether the detention is lawful. Used against illegal arrest or detention by the State or a private person.', tip: 'Habeas = free the person.', tier: 0 },
  { id: 'mandamus',   name: 'Mandamus',       latin: '"We command"',            use: 'Commands a public official or authority to perform a public legal duty it has refused or failed to perform. Not available against the President or Governors personally.', tip: 'Mandamus = Make them do it.', tier: 1 },
  { id: 'prohibition', name: 'Prohibition',   latin: '"To forbid"',             use: 'Issued by a higher court to a lower court or tribunal, while proceedings are pending, to stop it acting beyond its jurisdiction.', tip: 'Prohibition = Prevent (before the order).', tier: 1 },
  { id: 'certiorari', name: 'Certiorari',     latin: '"To be certified"',       use: 'Quashes an order already passed by a lower court or tribunal that acted without jurisdiction, breached natural justice or made an error of law apparent on the face of the record.', tip: 'Certiorari = Cancel (after the order).', tier: 2 },
  { id: 'quo',        name: 'Quo Warranto',   latin: '"By what authority"',     use: 'Challenges a person’s right to hold a public office, requiring them to show their legal authority.', tip: 'Quo Warranto = Who gave you the post?', tier: 2 }
];

/* ---------------------------------------------------------
   DATABASE: BHARATIYA NYAYA SANHITA (BNS, 2023; in force 1 July 2024)
   --------------------------------------------------------- */
const BNS_CHAPTERS = [
  { n: 'I',    title: 'Preliminary',                                          range: '1–3' },
  { n: 'II',   title: 'Of Punishments',                                       range: '4–13' },
  { n: 'III',  title: 'General Exceptions',                                   range: '14–44' },
  { n: 'IV',   title: 'Abetment, Criminal Conspiracy and Attempt',            range: '45–62' },
  { n: 'V',    title: 'Offences Against Woman and Child',                     range: '63–99' },
  { n: 'VI',   title: 'Offences Affecting the Human Body',                    range: '100–146' },
  { n: 'VII',  title: 'Offences Against the State',                           range: '147–158' },
  { n: 'XI',   title: 'Offences Against Public Tranquillity',                 range: '189–197' },
  { n: 'XVII', title: 'Offences Against Property',                            range: '303–334' },
  { n: 'XIX',  title: 'Criminal Intimidation, Insult, Annoyance, Defamation', range: '351–358' }
];
const B = (sec, ch, title, ipc, desc, pun, isNew) => ({ sec: String(sec), ch, title, ipc, desc, pun, isNew: !!isNew });
const BNS = [
  B('3(5)', 'I', 'Common intention', 'IPC 34', 'When a criminal act is done by several persons in furtherance of their common intention, each is liable as if he did it alone.', 'Same as the offence committed.'),
  B('4', 'II', 'Punishments (incl. community service)', 'IPC 53', 'Lists the kinds of punishment. Community service is a new punishment for certain petty offences.', 'Death, life, imprisonment, forfeiture, fine, community service.', true),
  B('61', 'IV', 'Criminal conspiracy', 'IPC 120B', 'An agreement between two or more persons to commit an illegal act, or a legal act by illegal means.', 'Depends on the object of the conspiracy.'),
  B('63', 'V', 'Rape (definition)', 'IPC 375', 'Defines the offence of rape and the circumstances in which sexual acts are without valid consent.', 'See punishment section 64.'),
  B('64', 'V', 'Punishment for rape', 'IPC 376', 'Prescribes punishment for rape, with enhanced punishment for aggravated forms.', 'Rigorous imprisonment of 10 years to life, plus fine.'),
  B('74', 'V', 'Assault to outrage modesty of a woman', 'IPC 354', 'Assault or criminal force against a woman intending to outrage her modesty.', '1 to 5 years, plus fine.'),
  B('75', 'V', 'Sexual harassment', 'IPC 354A', 'Unwelcome physical contact and advances, demand for sexual favours, showing pornography against will, or sexually coloured remarks.', 'Up to 3 years or fine or both (varies by clause).'),
  B('80', 'V', 'Dowry death', 'IPC 304B', 'Death of a woman within 7 years of marriage under unnatural circumstances, after cruelty or harassment for dowry.', 'Minimum 7 years, up to life.'),
  B('85', 'V', 'Cruelty by husband or his relatives', 'IPC 498A', 'Cruelty by a husband or his relatives towards a married woman, including harassment for unlawful demands (dowry) or conduct likely to drive her to harm herself.', 'Up to 3 years, plus fine.'),
  B('101', 'VI', 'Murder (definition)', 'IPC 300', 'Defines when culpable homicide amounts to murder, such as acting with intention to cause death.', 'See punishment section 103.'),
  B('103', 'VI', 'Punishment for murder', 'IPC 302', 'Whoever commits murder is punished under this section.', 'Death or life imprisonment, plus fine.'),
  B('103(2)', 'VI', 'Murder by a group (mob lynching)', 'New', 'Murder by a group of five or more persons acting together on grounds such as race, caste, community, sex, place of birth, language or personal belief.', 'Death or life imprisonment, plus fine.', true),
  B('105', 'VI', 'Culpable homicide not amounting to murder', 'IPC 304', 'Causing death with intention or knowledge that it is likely to cause death, but falling short of murder.', 'Life, or 5 to 10 years, plus fine.'),
  B('106', 'VI', 'Death by negligence', 'IPC 304A', 'Causing death by a rash or negligent act not amounting to culpable homicide. Doctors get a lighter limit; hit-and-run escape attracts higher punishment.', 'Up to 5 years plus fine (up to 10 years for escaping after rash driving).'),
  B('111', 'VI', 'Organised crime', 'New', 'Continuing unlawful activity such as kidnapping, robbery, extortion, cyber-crime or contract killing by a syndicate using violence or coercion for gain.', 'Death if death results; otherwise 5 years to life, plus fine of at least ₹5 lakh.', true),
  B('113', 'VI', 'Terrorist act', 'New (earlier in UAPA)', 'An act intended to threaten the unity, integrity, security or sovereignty of India or strike terror in people.', 'Death or life if death results; otherwise 5 years to life, plus fine.', true),
  B('115', 'VI', 'Voluntarily causing hurt', 'IPC 323', 'Causing bodily pain, disease or infirmity to a person on purpose.', 'Up to 1 year, or fine up to ₹10,000, or both.'),
  B('117', 'VI', 'Voluntarily causing grievous hurt', 'IPC 325', 'Intentionally causing serious injury such as loss of sight, hearing or a limb, or a fracture.', 'Up to 7 years, plus fine.'),
  B('137', 'VI', 'Kidnapping', 'IPC 363', 'Taking or enticing a minor, or a person of unsound mind, out of the keeping of the lawful guardian without consent.', 'Up to 7 years, plus fine.'),
  B('152', 'VII', 'Act endangering sovereignty, unity and integrity', 'IPC 124A (sedition) reframed', 'Purposely or knowingly exciting secession, armed rebellion, subversive activities or separatist feelings, or endangering India’s sovereignty. The word "sedition" no longer appears.', 'Life, or up to 7 years, plus fine.', true),
  B('189', 'XI', 'Unlawful assembly', 'IPC 141', 'An assembly of five or more persons with a common illegal object.', 'Up to 6 months or fine or both (basic).'),
  B('191', 'XI', 'Rioting', 'IPC 146 / 147', 'Force or violence used by an unlawful assembly in pursuit of its common object.', 'Up to 2 years (up to 5 years if armed with a deadly weapon).'),
  B('303', 'XVII', 'Theft', 'IPC 378 / 379', 'Dishonestly taking movable property out of someone’s possession without consent.', 'Up to 3 years or fine or both; community service for a first petty theft.'),
  B('304', 'XVII', 'Snatching', 'New', 'Suddenly or quickly seizing or taking away movable property from a person or their possession.', 'Up to 3 years, plus fine.', true),
  B('308', 'XVII', 'Extortion', 'IPC 383 / 384', 'Putting a person in fear of injury to dishonestly make him hand over property or valuable security.', 'Up to 7 years or fine or both.'),
  B('309', 'XVII', 'Robbery', 'IPC 390 / 392', 'Theft or extortion where the offender causes or threatens instant death, hurt or wrongful restraint.', 'Rigorous imprisonment up to 10 years, plus fine.'),
  B('310', 'XVII', 'Dacoity', 'IPC 391 / 395', 'Robbery committed or attempted by five or more persons together.', 'Life, or rigorous imprisonment up to 10 years, plus fine.'),
  B('316', 'XVII', 'Criminal breach of trust', 'IPC 405 / 406', 'Dishonestly misusing or converting property that has been entrusted to you.', 'Up to 5 years or fine or both.'),
  B('318', 'XVII', 'Cheating', 'IPC 415 / 420', 'Deceiving a person to dishonestly induce them to deliver property or do or omit something.', 'Up to 3 years or fine; up to 7 years plus fine when it induces delivery of property.'),
  B('324', 'XVII', 'Mischief', 'IPC 425', 'Intentionally causing damage or destruction to property to cause wrongful loss or damage.', 'Depends on the amount of damage caused.'),
  B('329', 'XVII', 'Criminal trespass', 'IPC 441 / 447', 'Entering property with intent to commit an offence, or to intimidate, insult or annoy the person in possession.', 'Up to 3 months or fine up to ₹5,000 or both.'),
  B('351', 'XIX', 'Criminal intimidation', 'IPC 503 / 506', 'Threatening a person with injury to person, reputation or property to cause alarm.', 'Up to 2 years or fine or both; up to 7 years for threats of death or grievous hurt.'),
  B('356', 'XIX', 'Defamation', 'IPC 499 / 500', 'Words, signs or visible representations that harm a person’s reputation.', 'Simple imprisonment up to 2 years, or fine, or both, or community service.')
];

/* ---------------------------------------------------------
   DATABASE: PROCEDURE (BNSS) AND EVIDENCE (BSA)
   --------------------------------------------------------- */
const BNSS = [
  { sec: '35',  act: 'BNSS', title: 'Arrest by police without warrant', old: 'CrPC 41', desc: 'Police may arrest without a warrant in specified cases; for lesser offences a notice of appearance is the first step.' },
  { sec: '47',  act: 'BNSS', title: 'Arrested person to be told grounds and bail rights', old: 'CrPC 50', desc: 'A person arrested without a warrant must be informed of the full particulars of the offence and of the right to bail.' },
  { sec: '173', act: 'BNSS', title: 'Information in cognizable cases (FIR)', old: 'CrPC 154', desc: 'Police must register an FIR for a cognizable offence. Allows e-FIR and Zero FIR at any police station irrespective of jurisdiction.' },
  { sec: '187', act: 'BNSS', title: 'Procedure when investigation cannot finish in 24 hours', old: 'CrPC 167', desc: 'An arrested person must be produced before a Magistrate within 24 hours, who decides on remand and custody limits.' },
  { sec: '479', act: 'BNSS', title: 'Maximum period of detention of undertrial prisoners', old: 'CrPC 436A', desc: 'An undertrial who has served one-third of the maximum sentence (first-time offender) or one-half (others) is entitled to bail.' },
  { sec: '480', act: 'BNSS', title: 'Bail in non-bailable offences', old: 'CrPC 437', desc: 'When a Magistrate may grant bail for a non-bailable offence and the conditions to be considered.' },
  { sec: '482', act: 'BNSS', title: 'Anticipatory bail', old: 'CrPC 438', desc: 'A person who fears arrest for a non-bailable offence can seek bail from the Sessions Court or High Court in advance.' },
  { sec: '483', act: 'BNSS', title: 'Special bail powers of High Court and Sessions Court', old: 'CrPC 439', desc: 'The High Court and Court of Session can grant bail or modify bail conditions.' }
];
const BSA = [
  { sec: '63', act: 'BSA', title: 'Admissibility of electronic records', old: 'Evidence Act 65B', desc: 'Electronic records (CCTV, emails, call data) are admissible when accompanied by the prescribed certificate on authenticity.' }
];
const PROC = BNSS.concat(BSA);

/* ---------------------------------------------------------
   DATABASE: LANDMARK CASES
   --------------------------------------------------------- */
const CASES = [
  { id: 'golaknath',   name: 'Golaknath v. State of Punjab',                year: 1967, topic: 'Amendment of Fundamental Rights', holding: 'Parliament cannot amend Fundamental Rights. This view was later overruled by Kesavananda Bharati.', refs: ['368', '13'], tier: 2 },
  { id: 'royappa',     name: 'E.P. Royappa v. State of Tamil Nadu',         year: 1974, topic: 'Equality and arbitrariness',     holding: 'Arbitrariness is the antithesis of equality: an arbitrary State action violates Article 14.', refs: ['14'], tier: 1 },
  { id: 'kesavananda', name: 'Kesavananda Bharati v. State of Kerala',      year: 1973, topic: 'Basic structure doctrine',       holding: 'Parliament can amend the Constitution but cannot destroy its basic structure. Decided by a 13-judge bench.', refs: ['368'], tier: 2 },
  { id: 'adm',         name: 'ADM Jabalpur v. Shivkant Shukla',             year: 1976, topic: 'Emergency and liberty',          holding: 'Held that Article 21 could be suspended during the Emergency. Later overruled by Puttaswamy (2017).', refs: ['21', '352'], tier: 3 },
  { id: 'maneka',      name: 'Maneka Gandhi v. Union of India',             year: 1978, topic: 'Expansion of Article 21',        holding: 'Procedure under Article 21 must be fair, just and reasonable. Arts 14, 19 and 21 are read together (the "golden triangle").', refs: ['21', '14', '19'], tier: 1 },
  { id: 'hussainara',  name: 'Hussainara Khatoon v. State of Bihar',        year: 1979, topic: 'Speedy trial and legal aid',     holding: 'The right to a speedy trial and free legal aid are part of Article 21.', refs: ['21', '39A'], tier: 1 },
  { id: 'minerva',     name: 'Minerva Mills v. Union of India',             year: 1980, topic: 'Balance of rights and DPSPs',    holding: 'Judicial review and the balance between Fundamental Rights and Directive Principles are part of the basic structure.', refs: ['368', '37'], tier: 3 },
  { id: 'olga',        name: 'Olga Tellis v. Bombay Municipal Corporation', year: 1985, topic: 'Right to livelihood',            holding: 'The right to livelihood is part of the right to life under Article 21.', refs: ['21'], tier: 1 },
  { id: 'indra',       name: 'Indra Sawhney v. Union of India',             year: 1992, topic: 'Reservations',                   holding: 'Upheld OBC reservation but capped total reservation at 50% and excluded the creamy layer.', refs: ['16'], tier: 2 },
  { id: 'bommai',      name: 'S.R. Bommai v. Union of India',               year: 1994, topic: "President's Rule",               holding: 'Article 356 is subject to judicial review; secularism is part of the basic structure.', refs: ['356'], tier: 3 },
  { id: 'dkbasu',      name: 'D.K. Basu v. State of West Bengal',           year: 1997, topic: 'Arrest and custody guidelines',  holding: 'Laid down mandatory guidelines on arrest and detention to prevent custodial torture.', refs: ['21', '22'], tier: 1 },
  { id: 'vishaka',     name: 'Vishaka v. State of Rajasthan',               year: 1997, topic: 'Workplace sexual harassment',    holding: 'Issued binding guidelines against sexual harassment at the workplace until a law was passed.', refs: ['14', '15', '21'], tier: 1 },
  { id: 'arnesh',      name: 'Arnesh Kumar v. State of Bihar',              year: 2014, topic: 'Arrest in cruelty cases',        holding: 'Arrest must not be automatic in offences punishable up to 7 years; police must record reasons using a checklist.', refs: ['21'], tier: 1 },
  { id: 'shreya',      name: 'Shreya Singhal v. Union of India',            year: 2015, topic: 'Online free speech',             holding: 'Struck down section 66A of the IT Act as violating freedom of speech under Article 19(1)(a).', refs: ['19'], tier: 1 },
  { id: 'puttaswamy',  name: 'K.S. Puttaswamy v. Union of India',           year: 2017, topic: 'Right to privacy',               holding: 'Privacy is a Fundamental Right under Article 21 and Part III. Overruled ADM Jabalpur on liberty.', refs: ['21'], tier: 2 },
  { id: 'navtej',      name: 'Navtej Singh Johar v. Union of India',        year: 2018, topic: 'Dignity and equality',           holding: 'Decriminalised consensual same-sex relations between adults by reading down section 377 of the IPC.', refs: ['14', '15', '19', '21'], tier: 2 },
  { id: 'antil',       name: 'Satender Kumar Antil v. CBI',                 year: 2022, topic: 'Bail reform',                    holding: 'Issued guidelines on bail and arrests, stressing that bail is the rule and jail the exception.', refs: ['21'], tier: 2 }
];

/* ---------------------------------------------------------
   DATABASE: FACTS (for newspaper "Did you know?")
   --------------------------------------------------------- */
const FACTS = [
  'The Constitution of India was adopted on 26 November 1949 and came into force on 26 January 1950.',
  'The Supreme Court of India was inaugurated on 28 January 1950.',
  'The Preamble has been amended only once, in 1976, adding "Socialist", "Secular" and "Integrity".',
  'Fundamental Duties (Article 51A) were added by the 42nd Amendment in 1976.',
  'The right to property was removed from Fundamental Rights in 1978 and is now Article 300A.',
  'Article 21A (right to education) was inserted by the 86th Amendment in 2002.',
  'The voting age was lowered from 21 to 18 by the 61st Amendment (1988).',
  'The Bharatiya Nyaya Sanhita, Bharatiya Nagarik Suraksha Sanhita and Bharatiya Sakshya Adhiniyam came into force on 1 July 2024, replacing the IPC, CrPC and Evidence Act.',
  'The "basic structure" doctrine comes from Kesavananda Bharati (1973).',
  'Article 32 protects Fundamental Rights; Article 226 gives High Courts wider writ power, also for ordinary legal rights.'
];

/* ---------------------------------------------------------
   DATABASE: CASE SCENARIOS (fact pattern -> correct citation)
   kind: article | bns | bnss | bsa | writ
   type: bail | pil | trial | writ | appeal
   --------------------------------------------------------- */
const S = (id, tier, type, kind, ref, title, facts, hint, explain) => ({ id, tier, type, kind, ref, title, facts, hint, explain });
const SCENARIOS = [
  S('s01', 0, 'bail',   'article', '22', 'Held Without Production', 'Your client was picked up by police on Monday and kept in the lockup until Thursday. Nobody took him before a Magistrate.', 'Think of the 24-hour rule for arrested persons.', 'Article 22(2): an arrested person must be produced before a Magistrate within 24 hours, excluding travel time.'),
  S('s02', 0, 'pil',    'article', '17', 'The Village Well', 'A Dalit family is stopped from drawing water from the village well by upper-caste villagers.', 'Which Article abolished a social practice altogether?', 'Article 17 abolishes untouchability and forbids its practice in any form.'),
  S('s03', 0, 'pil',    'article', '21A', 'Children Out of School', 'Forty children aged 8 to 12 in a hamlet have no school within reach and have never been enrolled.', 'Think of the age band 6 to 14.', 'Article 21A guarantees free and compulsory education to children aged 6 to 14.'),
  S('s04', 0, 'trial',  'article', '24', 'The Firecracker Unit', 'A 12-year-old boy was found working at a firecracker factory.', 'Which Article bars children from hazardous work?', 'Article 24 prohibits employment of children below 14 in factories, mines or other hazardous work.'),
  S('s05', 0, 'trial',  'article', '20', 'The Forced Signature', 'Police beat your client until he signed a confession.', 'Think of the right against being a witness against yourself.', 'Article 20(3): no person accused of an offence can be compelled to be a witness against himself.'),
  S('s06', 1, 'trial',  'article', '20', 'Tried Twice', 'Your client was already tried and acquitted for an offence. The State files a fresh case on the same facts.', 'Double jeopardy.', 'Article 20(2): no person shall be prosecuted and punished for the same offence more than once.'),
  S('s07', 0, 'pil',    'article', '23', 'Bonded at the Brick Kiln', 'Labourers at a brick kiln work without wages to pay off a family debt and are not allowed to leave.', 'Which Article bans begar and forced labour?', 'Article 23 prohibits trafficking and forced labour, including bonded labour.'),
  S('s08', 0, 'writ',   'article', '25', 'The Procession', 'Officials ban a peaceful religious procession by a community, with no threat to public order.', 'Individual freedom of conscience and practice.', 'Article 25 guarantees freedom of conscience and the right to profess, practise and propagate religion, subject to public order, morality and health.'),
  S('s09', 0, 'writ',   'article', '19', 'The Seized Weekly', 'Officials seize copies of a local weekly for criticising the district administration.', 'Think of the first of the six freedoms.', 'Article 19(1)(a) protects freedom of speech and expression, including the press.'),
  S('s10', 0, 'appeal', 'article', '16', 'The Recruitment Notice', 'A government recruitment notice invites only men of one religion to apply.', 'Equality in public employment.', 'Article 16 guarantees equality of opportunity in public employment and bars discrimination on religion, race, caste, sex and other grounds.'),
  S('s11', 0, 'trial',  'bns', '303', 'The Parked Bicycle', 'The accused took a bicycle parked outside a shop, intending to keep it, without the owner’s consent.', 'Dishonestly taking movable property.', 'BNS 303 punishes theft (earlier IPC 379).'),
  S('s12', 0, 'trial',  'bns', '304', 'The Phone Snatcher', 'A rider on a motorbike yanked a mobile phone from a woman’s hand and sped away.', 'This is a new offence in the BNS.', 'BNS 304 punishes snatching, a new offence created by the BNS.'),
  S('s13', 0, 'trial',  'bns', '318', 'The Fake Job', 'The accused took ₹50,000 from a youth by falsely promising a government job.', 'Deception inducing delivery of property.', 'BNS 318 covers cheating (earlier IPC 420).'),
  S('s14', 0, 'bail',   'bns', '351', 'The Phone Threat', 'The accused phoned his neighbour and threatened to burn down his house.', 'Threat to cause alarm.', 'BNS 351 punishes criminal intimidation (earlier IPC 506).'),
  S('s15', 1, 'trial',  'bns', '106', 'The Speeding Truck', 'A truck driver, driving far over the speed limit, hit a cyclist who died at the spot.', 'Death by rash or negligent act.', 'BNS 106 punishes causing death by negligence (earlier IPC 304A).'),
  S('s16', 1, 'trial',  'bns', '103', 'The Planned Stabbing', 'The accused planned and stabbed his rival with intent to kill. The rival died.', 'Punishment for murder.', 'BNS 103 prescribes punishment for murder (earlier IPC 302); murder is defined in BNS 101.'),
  S('s17', 1, 'bail',   'bns', '85', 'Dowry Harassment', 'A wife says her husband and in-laws have repeatedly harassed and humiliated her for more dowry.', 'Cruelty by husband or relatives.', 'BNS 85 punishes cruelty by a husband or his relatives (earlier IPC 498A). Remember Arnesh Kumar: no automatic arrest.'),
  S('s18', 1, 'trial',  'bns', '191', 'The Road Blockade', 'A crowd of 30 armed with sticks blocked a highway and smashed shops.', 'Unlawful assembly using force.', 'BNS 191 punishes rioting (earlier IPC 146/147).'),
  S('s19', 1, 'trial',  'bns', '310', 'The Jeweller’s House', 'Seven armed men broke into a jeweller’s house at night and robbed it.', 'Robbery by five or more.', 'BNS 310 punishes dacoity: robbery by five or more persons (earlier IPC 395).'),
  S('s20', 1, 'trial',  'bns', '316', 'The Treasurer', 'A cooperative society’s treasurer spends entrusted funds on personal expenses.', 'Entrusted property misused.', 'BNS 316 punishes criminal breach of trust (earlier IPC 406).'),
  S('s21', 1, 'pil',    'bns', '356', 'The False Post', 'A blogger falsely publishes that a shopkeeper cheats customers, harming his standing in town.', 'Harm to reputation.', 'BNS 356 punishes defamation (earlier IPC 500).'),
  S('s22', 1, 'trial',  'bns', '137', 'The Missing Child', 'A man takes a 10-year-old away from her parents’ custody without their consent.', 'Taking away from lawful guardianship.', 'BNS 137 punishes kidnapping (earlier IPC 363).'),
  S('s23', 1, 'trial',  'bns', '61', 'The Forged Deeds', 'Two men agree together to forge land documents, planning each step before any document is made.', 'Agreement to do an illegal act.', 'BNS 61 punishes criminal conspiracy (earlier IPC 120B).'),
  S('s24', 1, 'bail',   'bns', '308', 'The Shop Protection', 'The accused told a trader he would smash his shop unless he paid ₹20,000 every month.', 'Fear of injury to extract property.', 'BNS 308 punishes extortion (earlier IPC 384).'),
  S('s25', 0, 'writ',   'writ', 'habeas', 'The Vanished Brother', 'A young woman’s brother has vanished. Police deny holding him, but witnesses saw him taken into the thana.', 'Produce the person before the court.', 'Habeas corpus, "you may have the body", tests the legality of detention.'),
  S('s26', 1, 'writ',   'writ', 'mandamus', 'The Unissued Licence', 'For two years a municipal officer has refused to issue a trade licence to an eligible applicant, though the law requires it.', 'Command a public official to do his duty.', 'Mandamus commands a public authority to perform a public legal duty.'),
  S('s27', 1, 'writ',   'writ', 'prohibition', 'The Overreaching Tribunal', 'A tribunal is about to hear a case that is clearly outside its jurisdiction. Hearing is pending.', 'Stop it before it decides.', 'Prohibition stops a lower court or tribunal from exceeding jurisdiction while proceedings are pending.'),
  S('s28', 2, 'writ',   'writ', 'certiorari', 'The Flawed Order', 'A tribunal has already passed an order without giving your client a hearing. He wants it quashed.', 'Quash an order already made.', 'Certiorari quashes an order already passed for lack of jurisdiction, breach of natural justice or error of law.'),
  S('s29', 2, 'writ',   'writ', 'quo', 'The Unqualified Officer', 'A man is holding a public office without meeting the legal qualification.', 'By what authority?', 'Quo warranto challenges a person’s right to hold a public office.'),
  S('s30', 2, 'pil',    'article', '21', 'Biometrics Without a Law', 'The State collects fingerprints and iris scans of all residents without any law governing the data.', 'Privacy (Puttaswamy).', 'Privacy is a Fundamental Right under Article 21 (K.S. Puttaswamy, 2017).'),
  S('s31', 2, 'pil',    'article', '14', 'Licences for Relatives', 'A State rule gives liquor licences only to relatives of ministers.', 'Arbitrary classification.', 'Article 14 bars arbitrary State action (E.P. Royappa).'),
  S('s32', 2, 'writ',   'article', '32', 'Straight to the Supreme Court', 'A Fundamental Right of your client has been violated and he wants to approach the Supreme Court directly.', 'Heart and soul of the Constitution.', 'Article 32 lets a person move the Supreme Court directly to enforce Fundamental Rights.'),
  S('s33', 2, 'writ',   'article', '226', 'The High Court Route', 'Your client wants a writ for violation of a Fundamental Right as well as an ordinary legal right, from the High Court.', 'Wider than Article 32.', 'Article 226 empowers High Courts to issue writs for Fundamental Rights and other legal rights.'),
  S('s34', 2, 'appeal', 'article', '136', 'Special Leave', 'Your client lost in the High Court and seeks special leave to appeal to the Supreme Court.', 'SLP.', 'Article 136 allows the Supreme Court to grant special leave to appeal from any court or tribunal.'),
  S('s35', 2, 'appeal', 'article', '311', 'Dismissed Unheard', 'A civil servant was dismissed without any inquiry or chance to be heard.', 'Safeguards for civil servants.', 'Article 311(2): no dismissal or reduction in rank without an inquiry giving a reasonable opportunity of being heard.'),
  S('s36', 3, 'pil',    'article', '356', 'Governance Dismissed', 'The Centre has dismissed a State government and imposed President’s Rule. You challenge it.', 'Bommai.', 'Article 356 deals with failure of constitutional machinery; Bommai made it subject to judicial review.'),
  S('s37', 3, 'pil',    'article', '368', 'The Amendment', 'Parliament passes an amendment that would destroy a basic feature of the Constitution.', 'Kesavananda Bharati.', 'Article 368 gives the power to amend, but not to destroy the basic structure.'),
  S('s38', 3, 'pil',    'article', '39A', 'Prisoners Without Lawyers', 'Poor prisoners cannot afford a lawyer and no legal aid is provided.', 'A for Aid.', 'Article 39A directs the State to provide free legal aid and equal justice.'),
  S('s39', 3, 'pil',    'article', '44', 'One Law for All', 'A court notes the need for a common set of civil laws across religions.', 'Directive Principle.', 'Article 44 directs the State to endeavour to secure a Uniform Civil Code.'),
  S('s40', 3, 'appeal', 'article', '142', 'Complete Justice', 'No ordinary law gives the exact remedy, but the Supreme Court must do justice to a wronged party.', 'Any order necessary.', 'Article 142 lets the Supreme Court pass any order necessary to do complete justice.'),
  S('s41', 3, 'appeal', 'article', '72', 'The Mercy Petition', 'A convict on death row petitions the President for commutation of the sentence.', 'Mercy of the President.', 'Article 72 empowers the President to grant pardons and to suspend, remit or commute sentences.'),
  S('s42', 3, 'pil',    'article', '21', 'The Poisoned River', 'A factory pollutes the river. Villagers sue under their right to a clean environment.', 'Widest right.', 'Courts read the right to a clean environment into Article 21.'),
  S('s43', 1, 'bail',   'bnss', '482', 'Arrest Looming', 'Your client fears arrest on a false complaint and wants protection before he is arrested.', 'Bail in advance.', 'BNSS 482 provides anticipatory bail (earlier CrPC 438).'),
  S('s44', 1, 'bail',   'bnss', '187', 'Beyond 24 Hours', 'Police need more time, but the arrested person must be taken before a Magistrate for remand.', 'Production before Magistrate.', 'BNSS 187 (earlier CrPC 167) governs production within 24 hours and remand limits.'),
  S('s45', 2, 'bail',   'bnss', '479', 'The Long Undertrial', 'A first-time offender has served one-third of the maximum sentence while awaiting trial.', 'Undertrial detention limit.', 'BNSS 479 (earlier CrPC 436A) entitles him to bail.'),
  S('s46', 1, 'trial',  'bnss', '173', 'The Refused Complaint', 'The police refuse to register a cognizable-offence complaint because the crime happened outside their station limits.', 'FIR and Zero FIR.', 'BNSS 173 (earlier CrPC 154) provides for FIR, including e-FIR and Zero FIR.'),
  S('s47', 2, 'trial',  'bsa', '63', 'The CCTV Clip', 'The prosecution wants to use CCTV footage but the certificate for the electronic record is missing.', 'Evidence from a device.', 'BSA 63 (earlier Evidence Act 65B) governs admissibility of electronic records with a certificate.'),
  S('s48', 3, 'trial',  'bns', '113', 'The Blast', 'A group detonates a bomb in a market to strike terror and threaten the unity of the country.', 'New offence.', 'BNS 113 punishes a terrorist act, now part of the general criminal code.'),
  S('s49', 3, 'trial',  'bns', '111', 'The Syndicate', 'A syndicate runs continuing extortion and kidnapping for gain, using violence.', 'New offence.', 'BNS 111 punishes organised crime.'),
  S('s50', 3, 'trial',  'bns', '103(2)', 'The Mob', 'Six persons together beat a man to death because of his caste.', 'Murder by group.', 'BNS 103(2) is the new offence of murder by a group on discriminatory grounds.')
];

/* ---------------------------------------------------------
   DATABASE: UNIFIED LOOKUP
   --------------------------------------------------------- */
const ART_MAP = {}; ARTICLES.forEach(a => { ART_MAP[a.n] = a; });
const WRIT_MAP = {}; WRITS.forEach(w => { WRIT_MAP[w.id] = w; });
const BNS_MAP = {}; BNS.forEach(b => { BNS_MAP[b.sec] = b; });
const PROC_MAP = {}; PROC.forEach(p => { PROC_MAP[p.act + ':' + p.sec] = p; });
const CASE_MAP = {}; CASES.forEach(c => { CASE_MAP[c.id] = c; });
const PART_MAP = {}; PARTS.forEach(p => { PART_MAP[p.id] = p; });
const SC_MAP = {}; SCENARIOS.forEach(s => { SC_MAP[s.id] = s; });

function getItem(kind, ref) {
  switch (kind) {
    case 'article': return ART_MAP[ref] || null;
    case 'writ':    return WRIT_MAP[ref] || null;
    case 'bns':     return BNS_MAP[ref] || null;
    case 'bnss':    return PROC_MAP['BNSS:' + ref] || null;
    case 'bsa':     return PROC_MAP['BSA:' + ref] || null;
    case 'case':    return CASE_MAP[ref] || null;
    default: return null;
  }
}
function itemShort(kind, ref) {
  switch (kind) {
    case 'article': return ref === 'PRE' ? 'Preamble' : 'Art ' + ref;
    case 'bns': return 'BNS ' + ref;
    case 'bnss': return 'BNSS ' + ref;
    case 'bsa': return 'BSA ' + ref;
    case 'writ': return (WRIT_MAP[ref] || {}).name || ref;
    case 'case': return (CASE_MAP[ref] || {}).name || ref;
    default: return String(ref);
  }
}
function itemLabel(kind, ref) {
  const it = getItem(kind, ref); if (!it) return itemShort(kind, ref);
  switch (kind) {
    case 'article': return itemShort(kind, ref) + ' — ' + it.title;
    case 'bns': case 'bnss': case 'bsa': return itemShort(kind, ref) + ' — ' + it.title;
    case 'writ': return it.name;
    case 'case': return it.name + ' (' + it.year + ')';
    default: return String(ref);
  }
}
function allRefs(kind) {
  switch (kind) {
    case 'article': return ARTICLES.map(a => a.n);
    case 'writ': return WRITS.map(w => w.id);
    case 'bns': return BNS.map(b => b.sec);
    case 'bnss': return BNSS.map(b => b.sec);
    case 'bsa': return BSA.map(b => b.sec);
    case 'case': return CASES.map(c => c.id);
    default: return [];
  }
}
function groupOf(kind, ref) {
  const it = getItem(kind, ref); if (!it) return null;
  if (kind === 'article') return it.part;
  if (kind === 'bns') return it.ch;
  return kind;
}

SV.DB = { STYLES, CIRCUITS, RANKS, ROOMS, MOVES, PARTS, ARTICLES, WRITS, BNS_CHAPTERS, BNS, BNSS, BSA, PROC, CASES, FACTS, SCENARIOS,
          getItem, itemShort, itemLabel, allRefs };

/* ---------------------------------------------------------
   ROSTER GENERATION (46 characters: 4 mentors + 42 generated)
   --------------------------------------------------------- */
const MALE = ['Aarav', 'Vikram', 'Rohan', 'Suresh', 'Imran', 'Gurpreet', 'Venkat', 'Arjun', 'Nikhil', 'Rajesh', 'Karthik', 'Manoj', 'Abdul', 'Tenzin', 'Bhaskar', 'Ishaan', 'Harish', 'Mohan', 'Sandeep', 'Prakash', 'Faizal', 'Dev'];
const FEMALE = ['Meera', 'Priya', 'Kavita', 'Anita', 'Farah', 'Harpreet', 'Lakshmi', 'Deepa', 'Sneha', 'Pooja', 'Divya', 'Shalini', 'Zoya', 'Nandini', 'Radha', 'Ayesha', 'Revathi', 'Sunita', 'Tanvi', 'Geeta'];
const SURN = ['Sharma', 'Iyer', 'Reddy', 'Khan', 'Singh', 'Das', 'Patel', 'Nair', 'Menon', 'Bose', 'Mehta', 'Joshi', 'Gowda', 'Kulkarni', 'Banerjee', 'Chauhan', 'Verma', 'Rao', 'Pillai', 'Desai', 'Fernandes', 'Gill', 'Mukherjee', 'Naidu', 'Hegde', 'Shetty', 'Ansari', 'Kapoor'];
const PERSONAS = ['aggressive', 'technical', 'slippery', 'steady'];
const ROLE_PLAN = {
  advocate:   [4, 4, 3, 3],
  prosecutor: [3, 3, 2, 2],
  police:     [3, 3, 2, 1],
  judge:      [2, 2, 2, 3]
};
const ROLE_TITLES = {
  advocate:   ['Adv.', 'Adv.', 'Adv.', 'Sr. Adv.'],
  prosecutor: ['APP', 'Public Prosecutor', 'Spl. Public Prosecutor', 'Addl. Solicitor General'],
  police:     ['Constable', 'SI', 'Inspector', 'DSP'],
  judge:      ['Judge', 'Judge', 'Justice', 'Justice']
};
const ROLE_LABELS = { advocate: 'Rival Advocate', prosecutor: 'Public Prosecutor', police: 'Police Officer', judge: 'Judge', mentor: 'Senior Advocate (Ustad)' };
const ROLE_MODS = {
  advocate:   { power: 0,   flow: 6,  recall: 2,   fortitude: 0 },
  prosecutor: { power: 6,   flow: 0,  recall: 4,   fortitude: 2 },
  police:     { power: 8,   flow: -4, recall: -8,  fortitude: 4 },
  judge:      { power: -10, flow: 0,  recall: 10,  fortitude: 10 },
  mentor:     { power: 4,   flow: 6,  recall: 12,  fortitude: 6 }
};
const MENTORS = [
  { name: 'Sr. Adv. Savitri Menon',      tier: 0, female: true,  offers: ['probono'] },
  { name: 'Sr. Adv. Harbans Chadha',     tier: 1, female: false, offers: ['corporate', 'probono'] },
  { name: 'Sr. Adv. Abdul Rahim Qureshi', tier: 2, female: false, offers: ['corporate', 'probono'] },
  { name: 'Sr. Adv. Lalitha Krishnan',   tier: 3, female: true,  offers: ['corporate', 'probono'] }
];

function generateRoster(seed) {
  const rnd = mulberry32(seed);
  const used = new Set();
  const out = [];
  let counter = 1;

  function makeName(forceFemale) {
    for (let k = 0; k < 40; k++) {
      const fem = forceFemale !== undefined ? forceFemale : rnd() < 0.42;
      const nm = pick(fem ? FEMALE : MALE, rnd) + ' ' + pick(SURN, rnd);
      if (!used.has(nm)) { used.add(nm); return { name: nm, female: fem }; }
    }
    const nm = pick(MALE, rnd) + ' ' + pick(SURN, rnd) + ' ' + String.fromCharCode(65 + Math.floor(rnd() * 26));
    used.add(nm); return { name: nm, female: false };
  }
  function stat(base, mod) { return clamp(Math.round(base + (rnd() * 14 - 7) + mod), 20, 98); }
  function look(role, female) {
    return {
      build: pick(['slim', 'avg', 'avg', 'broad'], rnd),
      height: +(0.94 + rnd() * 0.14).toFixed(2),
      skin: Math.floor(rnd() * 6),
      hair: Math.floor(rnd() * 5),
      female: !!female,
      robe: role === 'police' ? '#7a6a3c' : role === 'judge' ? '#5a0f1c' : '#141414'
    };
  }
  function build(role, tier, name, female, extra) {
    const mod = ROLE_MODS[role] || ROLE_MODS.advocate;
    const base = 28 + tier * 16;
    const art = pick(ARTICLES.filter(a => a.tier <= tier + 1 && a.part === 'III'), rnd);
    const npc = Object.assign({
      id: 'npc' + (counter++),
      role, tier, name, female,
      stats: { power: stat(base, mod.power), flow: stat(base, mod.flow), recall: stat(base, mod.recall), fortitude: stat(base, mod.fortitude) },
      persona: pick(PERSONAS, rnd),
      favourite: art ? art.n : '21',
      corrupt: role === 'police' && tier >= 1 && rnd() < 0.3,
      look: look(role, female)
    }, extra || {});
    out.push(npc);
    return npc;
  }

  Object.keys(ROLE_PLAN).forEach(role => {
    ROLE_PLAN[role].forEach((count, tier) => {
      for (let i = 0; i < count; i++) {
        const nm = makeName();
        const prefix = ROLE_TITLES[role][tier];
        build(role, tier, prefix + ' ' + nm.name, nm.female, { baseName: nm.name });
      }
    });
  });
  MENTORS.forEach(m => {
    used.add(m.name);
    build('mentor', m.tier, m.name, m.female, { offers: m.offers, baseName: m.name.replace('Sr. Adv. ', '') });
  });
  return out;
}

/* ---------------------------------------------------------
   OFFERS (Ustads / Senior Advocates)
   --------------------------------------------------------- */
const OFFER_TEMPLATES = {
  probono: {
    id: 'probono', title: 'Pro-Bono Human Rights Brief',
    desc: 'No fee, but a high-profile case that builds your name. Next case: fee ₹0, reputation x2.',
    effect: { feeMult: 0, repMult: 2, weeks: 0 }
  },
  corporate: {
    id: 'corporate', title: 'Corporate Retainer',
    desc: 'A steady weekly retainer for 6 weeks. Next case pays x1.5 but earns 30% less reputation.',
    effect: { feeMult: 1.5, repMult: 0.7, weeks: 6 }
  }
};

/* ---------------------------------------------------------
   SAVE DATA
   --------------------------------------------------------- */
const SAVE_KEY = 'samvidhan_legal_empire_save_v1';
const SETTINGS_KEY = 'samvidhan_legal_empire_settings_v1';
const SAVE_VERSION = 1;
const INTERVAL_DAYS = [0, 0, 1, 3, 7, 14];   // Leitner boxes 1..5
const DAY_MS = 86400000;

const DEFAULT_SETTINGS = { volume: 70, ambience: 50, stick: 100, buttons: 100, haptics: true, shake: true, lowgfx: false };

function defaultSave() {
  return {
    v: SAVE_VERSION,
    seed: Math.floor(Math.random() * 1e9) + 1,
    created: Date.now(), updated: Date.now(),
    week: 1, casesThisWeek: 0,
    player: {
      name: 'You', style: 'balanced', robe: '#1a1a1a',
      stats: { power: 44, flow: 44, recall: 44, fortitude: 44 },
      rep: 0, purse: 0, circuit: 0
    },
    record: { cases: 0, wins: 0, losses: 0, citations: 0, correct: 0, perfect: 0, earned: 0 },
    defeated: [],
    recentScenarios: [],
    mastery: {},
    learning: { streak: 0, best: 0, lastDay: '', answered: 0, correct: 0, quizRepDay: '', quizRepCount: 0, dailyDone: '', dailyScore: 0 },
    retainer: null,
    nextCaseMod: null,
    log: [],
    flags: { tutorialDone: false }
  };
}

/* ---------------------------------------------------------
   STATE MODULE
   --------------------------------------------------------- */
let data = defaultSave();
let roster = [];
let settings = Object.assign({}, DEFAULT_SETTINGS);
let saveTimer = null;
const listeners = {};

function emit(ev, payload) { (listeners[ev] || []).forEach(fn => { try { fn(payload); } catch (e) { console.error(e); } }); }
function on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }
function off(ev, fn) { listeners[ev] = (listeners[ev] || []).filter(f => f !== fn); }

function ls() { try { return global.localStorage; } catch (e) { return null; } }

function save() {
  data.updated = Date.now();
  const s = ls(); if (!s) return false;
  try { s.setItem(SAVE_KEY, JSON.stringify(data)); return true; } catch (e) { console.warn('Save failed', e); return false; }
}
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; save(); }, 800);
}
function hasSave() { const s = ls(); try { return !!(s && s.getItem(SAVE_KEY)); } catch (e) { return false; } }
function load() {
  const s = ls(); if (!s) return false;
  try {
    const raw = s.getItem(SAVE_KEY); if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return false;
    data = deepMerge(defaultSave(), parsed);
    data.v = SAVE_VERSION;
    roster = generateRoster(data.seed);
    emit('change');
    return true;
  } catch (e) { console.warn('Load failed', e); return false; }
}
function eraseSave() {
  const s = ls(); try { if (s) s.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  data = defaultSave(); roster = []; emit('change');
}
function loadSettings() {
  const s = ls();
  try { const raw = s && s.getItem(SETTINGS_KEY); if (raw) settings = Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw)); } catch (e) { /* ignore */ }
  return settings;
}
function setSetting(k, v) {
  settings[k] = v;
  const s = ls(); try { if (s) s.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
  applySettingsToCSS(); emit('settings', settings);
}
function applySettingsToCSS() {
  const r = global.document && global.document.documentElement; if (!r) return;
  r.style.setProperty('--stick-scale', String((settings.stick || 100) / 100));
  r.style.setProperty('--btn-scale', String((settings.buttons || 100) / 100));
}

function newCareer(opts) {
  opts = opts || {};
  const style = STYLES[opts.style] ? opts.style : 'balanced';
  data = defaultSave();
  data.player.name = (opts.name || 'You').trim().slice(0, 18) || 'You';
  data.player.style = style;
  data.player.robe = opts.robe || '#1a1a1a';
  data.player.stats = Object.assign({}, STYLES[style].stats);
  roster = generateRoster(data.seed);
  logEvent('start', data.player.name + ' enrols at the Bar.', 'NEW ADVOCATE ' + data.player.name.toUpperCase() + ' ENROLS AT THE BAR');
  save(); emit('change');
  return data;
}

/* ---------------------------------------------------------
   PLAYER HELPERS
   --------------------------------------------------------- */
function circuit() { return CIRCUITS[data.player.circuit]; }
function rankTitle() { let t = RANKS[0].title; RANKS.forEach(r => { if (data.player.rep >= r.min) t = r.title; }); return t; }
function maxHealth() { return Math.round(60 + data.player.stats.fortitude); }
function maxFlow() { return Math.round(60 + data.player.stats.flow); }
function isRoomUnlocked(id) { const r = ROOMS[id]; return !!r && data.player.circuit >= r.minCircuit; }
function courtLabel() { return circuit().room; }
function logEvent(type, text, headline) {
  data.log.push({ t: Date.now(), week: data.week, type, text, headline: headline || null });
  if (data.log.length > 60) data.log = data.log.slice(-60);
}

/* ---------------------------------------------------------
   LEARNING ENGINE (Leitner spaced repetition)
   Box 0 = unseen. Box 3 = "Understood". Box 4+ = "Mastered".
   --------------------------------------------------------- */
function mKey(kind, ref) { return kind + ':' + ref; }
function getMastery(kind, ref) { return data.mastery[mKey(kind, ref)] || { box: 0, seen: 0, correct: 0, wrong: 0, due: 0 }; }
function stars(kind, ref) { return getMastery(kind, ref).box; }
function masteredCount(minBox) {
  const mb = minBox || 3; let n = 0;
  Object.keys(data.mastery).forEach(k => { if (data.mastery[k].box >= mb) n++; });
  return n;
}
function touchStudy() {
  const L = data.learning, t = dayKey(0);
  if (L.lastDay === t) return;
  L.streak = (L.lastDay === dayKey(-1)) ? L.streak + 1 : 1;
  L.best = Math.max(L.best, L.streak);
  L.lastDay = t;
}
function recordAnswer(kind, ref, correct) {
  touchStudy();
  const key = mKey(kind, ref);
  const m = data.mastery[key] || (data.mastery[key] = { box: 0, seen: 0, correct: 0, wrong: 0, due: 0, last: 0 });
  const prev = m.box;
  m.seen++; m.last = Date.now();
  if (correct) { m.correct++; m.box = prev === 0 ? 2 : clamp(prev + 1, 1, 5); }
  else { m.wrong++; m.box = prev === 0 ? 1 : Math.max(1, prev - 1); }
  m.due = Date.now() + INTERVAL_DAYS[m.box] * DAY_MS;
  data.learning.answered++;
  if (correct) data.learning.correct++;
  let gain = 0;
  if (correct && m.box > prev) {
    gain = 0.2;
    data.player.stats.recall = Math.min(100, +(data.player.stats.recall + gain).toFixed(2));
  }
  const becameMastered = m.box >= 4 && prev < 4;
  if (becameMastered) logEvent('mastery', 'Mastered ' + itemLabel(kind, ref) + '.');
  scheduleSave(); emit('change');
  return { key, box: m.box, prevBox: prev, leveled: m.box > prev, mastered: becameMastered, recallGain: gain };
}

/* ---- Question building ---- */
function buildOptions(correctLabel, candidates, rnd) {
  const pool = shuffle(Array.from(new Set(candidates.filter(c => c !== correctLabel))), rnd).slice(0, 3);
  const options = shuffle(pool.concat([correctLabel]), rnd);
  return { options, correctIndex: options.indexOf(correctLabel) };
}
function distractorRefs(kind, ref, rnd) {
  const all = allRefs(kind).filter(r => r !== ref);
  const grp = groupOf(kind, ref);
  const same = all.filter(r => groupOf(kind, r) === grp && grp !== kind);
  const rest = all.filter(r => !same.includes(r));
  return shuffle(same, rnd).concat(shuffle(rest, rnd)).slice(0, 6);
}
function labelFor(kind, ref, style) { return style === 'short' ? itemShort(kind, ref) : itemLabel(kind, ref); }

function questionFromScenario(s, rnd) {
  const dist = distractorRefs(s.kind, s.ref, rnd).slice(0, 3);
  const cands = dist.map(r => itemLabel(s.kind, r));
  const o = buildOptions(itemLabel(s.kind, s.ref), cands, rnd);
  return { id: 'sc:' + s.id, kind: s.kind, ref: s.ref, type: 'scenario', title: s.title, prompt: s.facts, hint: s.hint, explain: s.explain, options: o.options, correctIndex: o.correctIndex };
}
function questionDefine(kind, ref, rnd) {
  const it = getItem(kind, ref); if (!it) return null;
  const dist = distractorRefs(kind, ref, rnd);
  if (kind === 'article') {
    if (rnd() < 0.5) {
      const o = buildOptions(itemShort(kind, ref), dist.map(r => itemShort(kind, r)), rnd);
      return { id: 'def:' + kind + ':' + ref, kind, ref, type: 'define', title: 'Which Article?', prompt: it.summary, hint: it.tip, explain: itemLabel(kind, ref) + '. ' + it.tip, options: o.options, correctIndex: o.correctIndex };
    }
    const o = buildOptions(it.title, dist.map(r => ART_MAP[r].title), rnd);
    return { id: 'rev:' + kind + ':' + ref, kind, ref, type: 'define', title: 'What does it say?', prompt: 'Article ' + ref + ' is about…', hint: it.tip, explain: it.summary, options: o.options, correctIndex: o.correctIndex };
  }
  if (kind === 'bns') {
    if (it.ipc && /^IPC \d/.test(it.ipc) && rnd() < 0.4) {
      const others = BNS.filter(b => b.sec !== ref && /^IPC \d/.test(b.ipc)).map(b => b.ipc);
      const o = buildOptions(it.ipc, others, rnd);
      return { id: 'ipc:' + ref, kind, ref, type: 'define', title: 'Old law → new law', prompt: 'BNS ' + ref + ' (' + it.title + ') replaced which old IPC provision?', hint: 'The BNS replaced the IPC on 1 July 2024.', explain: 'BNS ' + ref + ' corresponds to ' + it.ipc + '.', options: o.options, correctIndex: o.correctIndex };
    }
    const o = buildOptions('BNS ' + ref, dist.map(r => 'BNS ' + r), rnd);
    return { id: 'def:bns:' + ref, kind, ref, type: 'define', title: 'Which BNS section?', prompt: it.desc, hint: it.ipc && it.ipc !== 'New' ? 'Earlier: ' + it.ipc : 'This is a new offence.', explain: 'BNS ' + ref + ' — ' + it.title + '. ' + it.pun, options: o.options, correctIndex: o.correctIndex };
  }
  if (kind === 'bnss' || kind === 'bsa') {
    const o = buildOptions(itemShort(kind, ref), dist.map(r => itemShort(kind, r)), rnd);
    return { id: 'def:' + kind + ':' + ref, kind, ref, type: 'define', title: kind === 'bnss' ? 'Which BNSS section?' : 'Which BSA section?', prompt: it.desc, hint: 'Earlier: ' + it.old, explain: itemLabel(kind, ref) + ' (earlier ' + it.old + ').', options: o.options, correctIndex: o.correctIndex };
  }
  if (kind === 'writ') {
    const o = buildOptions(it.name, dist.map(r => WRIT_MAP[r].name), rnd);
    return { id: 'def:writ:' + ref, kind, ref, type: 'define', title: 'Which writ?', prompt: it.use, hint: it.tip, explain: it.name + ' ' + it.latin + '. ' + it.tip, options: o.options, correctIndex: o.correctIndex };
  }
  if (kind === 'case') {
    const o = buildOptions(itemLabel(kind, ref), dist.map(r => itemLabel(kind, r)), rnd);
    return { id: 'def:case:' + ref, kind, ref, type: 'define', title: 'Which landmark case?', prompt: it.holding, hint: it.topic, explain: it.name + ' (' + it.year + '): ' + it.holding, options: o.options, correctIndex: o.correctIndex };
  }
  return null;
}
function makeQuestion(kind, ref, rnd) {
  rnd = rnd || Math.random;
  const scs = SCENARIOS.filter(s => s.kind === kind && s.ref === ref);
  if (scs.length && rnd() < 0.6) return questionFromScenario(pick(scs, rnd), rnd);
  return questionDefine(kind, ref, rnd) || (scs.length ? questionFromScenario(pick(scs, rnd), rnd) : null);
}

function quizPool(focus, tierMax) {
  const items = [];
  const add = (kind, refs) => refs.forEach(ref => {
    const it = getItem(kind, ref);
    if (it && it.tier !== undefined && it.tier > tierMax) return;
    items.push({ kind, ref });
  });
  if (focus === 'all' || focus === 'articles') add('article', allRefs('article'));
  if (focus === 'all' || focus === 'writs')    add('writ', allRefs('writ'));
  if (focus === 'all' || focus === 'bns')      add('bns', allRefs('bns'));
  if (focus === 'all' || focus === 'procedure') { add('bnss', allRefs('bnss')); add('bsa', allRefs('bsa')); }
  if (focus === 'all' || focus === 'cases')    add('case', allRefs('case'));
  return items;
}
function itemWeight(kind, ref) {
  const m = data.mastery[mKey(kind, ref)];
  if (!m || m.box === 0) return 2.5;
  if (m.due <= Date.now()) return 4;
  if (m.box <= 2) return 3;
  if (m.box === 3) return 1.2;
  return 0.4;
}
/* opts: { focus:'all|articles|writs|bns|procedure|cases', tierMax, rnd } */
function makeQuestions(count, opts) {
  opts = opts || {};
  const rnd = opts.rnd || Math.random;
  const tierMax = opts.tierMax !== undefined ? opts.tierMax : data.player.circuit + 1;
  let pool = quizPool(opts.focus || 'all', tierMax);
  if (!pool.length) pool = quizPool(opts.focus || 'all', 3);
  const out = [];
  const bag = pool.slice();
  while (out.length < count && bag.length) {
    const total = bag.reduce((s, it) => s + itemWeight(it.kind, it.ref), 0);
    let r = rnd() * total, idx = 0;
    for (let i = 0; i < bag.length; i++) { r -= itemWeight(bag[i].kind, bag[i].ref); if (r <= 0) { idx = i; break; } }
    const it = bag.splice(idx, 1)[0];
    const q = makeQuestion(it.kind, it.ref, rnd);
    if (q) out.push(q);
  }
  return out;
}
/* Called by quiz UI after the last answer. Returns the reward summary. */
function finishQuiz(summary) {
  const total = summary.total || 0, correct = summary.correct || 0;
  const t = dayKey(0), L = data.learning;
  if (L.quizRepDay !== t) { L.quizRepDay = t; L.quizRepCount = 0; }
  const repCap = 15;
  const rep = Math.min(Math.floor(correct / 2), Math.max(0, repCap - L.quizRepCount));
  L.quizRepCount += rep;
  const fee = correct * 25 * (data.player.circuit + 1);
  data.player.rep += rep; data.player.purse += fee;
  if (total) logEvent('learn', 'Study session: ' + correct + '/' + total + ' correct.');
  const promo = checkPromotion();
  save(); emit('change');
  return { rep, fee, promo, capped: rep === 0 && correct >= 2 };
}
/* Daily moot: same 5 questions for the whole day */
function getDailyChallenge() {
  const rnd = mulberry32(hashStr(dayKey(0)) ^ data.seed);
  return { day: dayKey(0), done: data.learning.dailyDone === dayKey(0), questions: makeQuestions(5, { rnd, tierMax: data.player.circuit + 1 }) };
}
function completeDaily(correct, total) {
  const t = dayKey(0);
  if (data.learning.dailyDone === t) return null;
  data.learning.dailyDone = t; data.learning.dailyScore = correct;
  touchStudy();
  const bonus = Math.min(data.learning.streak, 7);
  const rep = correct * 2 + bonus;
  const fee = (correct * 100 + bonus * 50) * (data.player.circuit + 1);
  data.player.rep += rep; data.player.purse += fee;
  logEvent('daily', 'Daily Moot: ' + correct + '/' + total + ' correct (streak ' + data.learning.streak + ').');
  const promo = checkPromotion();
  save(); emit('change');
  return { rep, fee, streak: data.learning.streak, promo };
}

/* Progress by Part / Chapter, for the Law Library path screen */
function getLearningPath() {
  const done = (kind, ref) => getMastery(kind, ref).box >= 3;
  const groups = [];
  const cons = [];
  PARTS.forEach(p => {
    const arts = ARTICLES.filter(a => a.part === p.id);
    if (!arts.length) return;
    const m = arts.filter(a => done('article', a.n)).length;
    cons.push({ id: p.id, title: 'Part ' + p.id + ': ' + p.title, range: p.range, total: arts.length, mastered: m, pct: Math.round(100 * m / arts.length) });
  });
  groups.push({ id: 'constitution', title: 'Constitution of India', items: cons });
  const bnsItems = [];
  BNS_CHAPTERS.forEach(c => {
    const secs = BNS.filter(b => b.ch === c.n);
    if (!secs.length) return;
    const m = secs.filter(b => done('bns', b.sec)).length;
    bnsItems.push({ id: 'bns' + c.n, title: 'BNS Chapter ' + c.n + ': ' + c.title, range: 'Secs ' + c.range, total: secs.length, mastered: m, pct: Math.round(100 * m / secs.length) });
  });
  groups.push({ id: 'bns', title: 'Bharatiya Nyaya Sanhita', items: bnsItems });
  const procM = PROC.filter(p => done(p.act.toLowerCase(), p.sec)).length;
  groups.push({ id: 'procedure', title: 'Procedure & Evidence', items: [{ id: 'proc', title: 'BNSS & BSA essentials', range: 'Bail, FIR, arrest, evidence', total: PROC.length, mastered: procM, pct: Math.round(100 * procM / PROC.length) }] });
  const wm = WRITS.filter(w => done('writ', w.id)).length;
  const cm = CASES.filter(c => done('case', c.id)).length;
  groups.push({ id: 'remedies', title: 'Remedies & Case Law', items: [
    { id: 'writs', title: 'The Five Writs', range: 'Arts 32 & 226', total: WRITS.length, mastered: wm, pct: Math.round(100 * wm / WRITS.length) },
    { id: 'cases', title: 'Landmark Cases', range: CASES.length + ' cases', total: CASES.length, mastered: cm, pct: Math.round(100 * cm / CASES.length) }
  ] });
  return groups;
}

/* Codex entries for the Article/Writ/BNS/Procedure/Case tabs */
function getCodex(tab, query) {
  const q = (query || '').trim().toLowerCase();
  let list = [];
  if (tab === 'articles') {
    list = ARTICLES.map(a => ({ kind: 'article', ref: a.n, badge: a.n === 'PRE' ? 'PRE' : a.n, title: a.title, body: a.summary, tip: a.tip, group: 'Part ' + a.part + ': ' + PART_MAP[a.part].title }));
  } else if (tab === 'writs') {
    list = WRITS.map(w => ({ kind: 'writ', ref: w.id, badge: 'WRIT', title: w.name + ' ' + w.latin, body: w.use, tip: w.tip, group: 'Arts 32 & 226' }));
  } else if (tab === 'bns') {
    list = BNS.map(b => ({ kind: 'bns', ref: b.sec, badge: b.sec, title: b.title + (b.isNew ? '  [NEW]' : ''), body: b.desc + ' Punishment: ' + b.pun, tip: b.ipc ? 'Earlier: ' + b.ipc : '', group: 'Chapter ' + b.ch }));
  } else if (tab === 'procedure') {
    list = PROC.map(p => ({ kind: p.act.toLowerCase(), ref: p.sec, badge: p.act + ' ' + p.sec, title: p.title, body: p.desc, tip: 'Earlier: ' + p.old, group: p.act }));
  } else if (tab === 'cases') {
    list = CASES.map(c => ({ kind: 'case', ref: c.id, badge: String(c.year), title: c.name, body: c.holding, tip: c.topic, group: 'Landmark' }));
  }
  list.forEach(e => { e.stars = stars(e.kind, e.ref); });
  if (q) list = list.filter(e => (e.badge + ' ' + e.title + ' ' + e.body + ' ' + e.tip).toLowerCase().includes(q));
  return list;
}

/* ---------------------------------------------------------
   CIRCUITS, PROMOTION
   --------------------------------------------------------- */
function promotionStatus() {
  const next = CIRCUITS[data.player.circuit + 1];
  if (!next) return { maxed: true };
  const have = masteredCount(3);
  return {
    maxed: false, next,
    repNeeded: next.repReq, repHave: data.player.rep,
    masteryNeeded: next.masteryReq, masteryHave: have,
    ready: data.player.rep >= next.repReq && have >= next.masteryReq
  };
}
function checkPromotion() {
  const st = promotionStatus();
  if (st.maxed) return null;
  if (st.ready) {
    data.player.circuit++;
    const c = circuit();
    logEvent('promotion', data.player.name + ' is promoted to the ' + c.name + '.', 'ADV. ' + data.player.name.toUpperCase() + ' ELEVATED TO ' + c.name.toUpperCase());
    return { promoted: true, circuit: c, unlockedRoom: c.id === 2 ? 'chambers' : null };
  }
  if (st.repHave >= st.repNeeded && st.masteryHave < st.masteryNeeded) {
    return { promoted: false, blocked: true, reason: 'Master ' + (st.masteryNeeded - st.masteryHave) + ' more Articles, sections or cases in the Law Library to reach the ' + st.next.name + '.' };
  }
  return null;
}

/* ---------------------------------------------------------
   CASE GENERATION & RESOLUTION
   --------------------------------------------------------- */
const TYPE_LABELS = { bail: 'BAIL HEARING', pil: 'PUBLIC INTEREST LITIGATION', trial: 'CRIMINAL TRIAL', writ: 'WRIT PETITION', appeal: 'APPEAL' };
const OPP_ROLE_BY_TYPE = { bail: 'prosecutor', trial: 'prosecutor', pil: 'advocate', writ: 'advocate', appeal: 'advocate' };

function npcsBy(role, tier) { return roster.filter(n => n.role === role && n.tier === tier); }
function getNpc(id) { return roster.find(n => n.id === id) || null; }
function randomRange(a, b) { return Math.round(a + Math.random() * (b - a)); }

function generateCase(opts) {
  opts = opts || {};
  const c = data.player.circuit;
  let cands = SCENARIOS.filter(s => s.tier === c || s.tier === c - 1 || (c === 0 && s.tier <= 1 && s.tier === 0));
  if (!cands.length) cands = SCENARIOS.filter(s => s.tier <= c);
  const fresh = cands.filter(s => !data.recentScenarios.includes(s.id));
  if (fresh.length) cands = fresh;
  const total = cands.reduce((sum, s) => sum + itemWeight(s.kind, s.ref), 0);
  let r = Math.random() * total, sc = cands[0];
  for (const s of cands) { r -= itemWeight(s.kind, s.ref); if (r <= 0) { sc = s; break; } }
  data.recentScenarios.push(sc.id); if (data.recentScenarios.length > 8) data.recentScenarios.shift();

  const oppRole = OPP_ROLE_BY_TYPE[sc.type] || 'advocate';
  let opps = npcsBy(oppRole, c); if (!opps.length) opps = npcsBy('advocate', c);
  const opp = pick(opps);
  const judge = pick(npcsBy('judge', c)) || null;
  const circ = circuit();
  const diff = sc.tier >= c ? 2 : 1;
  const mod = data.nextCaseMod || { feeMult: 1, repMult: 1 };
  const fee = Math.round(randomRange(circ.feeMin, circ.feeMax) * (0.8 + 0.2 * diff) * mod.feeMult);
  const rep = Math.round(circ.repBase * (0.8 + 0.2 * diff) * mod.repMult);
  return {
    id: 'case' + Date.now().toString(36), scenarioId: sc.id,
    title: sc.title, type: sc.type, typeLabel: TYPE_LABELS[sc.type] || 'HEARING',
    court: circ.name, circuit: c, fee, rep, difficulty: diff,
    facts: sc.facts, hint: sc.hint, explain: sc.explain, kind: sc.kind, ref: sc.ref,
    opponentId: opp ? opp.id : null, judgeId: judge ? judge.id : null,
    modifier: data.nextCaseMod ? data.nextCaseMod.id : null,
    question: questionFromScenario(sc, Math.random)
  };
}

/* result: { won:boolean, correct:int, total:int }  (citation challenges in the match) */
function resolveCase(cs, result) {
  const won = !!result.won, correct = result.correct || 0, total = result.total || 0;
  const perfect = total > 0 && correct === total;
  const R = data.record; R.cases++; R.citations += total; R.correct += correct;
  if (won) R.wins++; else R.losses++;
  if (perfect && won) R.perfect++;

  let repDelta, feeDelta;
  if (won) {
    repDelta = Math.round(cs.rep * (1 + 0.15 * correct) + (perfect ? 3 : 0));
    feeDelta = cs.fee;
  } else {
    repDelta = -Math.round(cs.rep * 0.25);
    feeDelta = 0;
  }
  data.nextCaseMod = null;
  const before = data.player.rep;
  data.player.rep = Math.max(0, data.player.rep + repDelta);
  repDelta = data.player.rep - before;
  data.player.purse += feeDelta; R.earned += feeDelta;

  if (won) {
    const s = data.player.stats;
    s.flow = Math.min(100, +(s.flow + 0.4).toFixed(2));
    s.power = Math.min(100, +(s.power + 0.3).toFixed(2));
    if (cs.opponentId && !data.defeated.includes(cs.opponentId)) data.defeated.push(cs.opponentId);
    logEvent('win', 'Adv. ' + data.player.name + ' won "' + cs.title + '" (' + cs.typeLabel.toLowerCase() + ', ' + cs.court + '), citing ' + itemShort(cs.kind, cs.ref) + '.', 'ADV. ' + data.player.name.toUpperCase() + ' WINS "' + cs.title.toUpperCase() + '"');
  } else {
    logEvent('loss', 'Adv. ' + data.player.name + ' lost "' + cs.title + '" at the ' + cs.court + '. The Bar says: read ' + itemShort(cs.kind, cs.ref) + ' again.', 'SETBACK FOR ADV. ' + data.player.name.toUpperCase() + ' IN "' + cs.title.toUpperCase() + '"');
  }
  recordAnswer(cs.kind, cs.ref, won && correct > 0 ? true : (total === 0 ? won : correct > 0));

  const promo = checkPromotion();
  let weekAdvanced = null;
  data.casesThisWeek++;
  if (data.casesThisWeek >= 2) weekAdvanced = advanceWeek();
  save(); emit('change');
  return { won, perfect, repDelta, feeDelta, promo, weekAdvanced, explain: cs.explain };
}

function advanceWeek() {
  data.week++; data.casesThisWeek = 0;
  let paid = 0;
  if (data.retainer) {
    const pay = data.retainer.weekly || 0;
    data.player.purse += pay; paid = pay;
    data.retainer.weeksLeft--;
    if (data.retainer.weeksLeft <= 0) { logEvent('retainer', 'Corporate retainer concluded.'); data.retainer = null; }
  }
  return { week: data.week, retainerPaid: paid };
}

/* ---------------------------------------------------------
   OFFERS (Ustad / Senior Advocate)
   --------------------------------------------------------- */
function getOffers() {
  const c = data.player.circuit;
  const mentors = roster.filter(n => n.role === 'mentor' && n.tier <= c);
  const out = [];
  mentors.forEach(m => m.offers.forEach(id => {
    const t = OFFER_TEMPLATES[id]; if (!t) return;
    if (id === 'corporate' && data.retainer) return;
    out.push({ offerId: id + ':' + m.id, templateId: id, mentorId: m.id, mentor: m.name, title: t.title, desc: t.desc,
               weekly: id === 'corporate' ? Math.round(CIRCUITS[m.tier].feeMin * 1.2) : 0 });
  }));
  return out;
}
function acceptOffer(offerId) {
  const o = getOffers().find(x => x.offerId === offerId); if (!o) return null;
  const t = OFFER_TEMPLATES[o.templateId];
  data.nextCaseMod = { id: o.templateId, feeMult: t.effect.feeMult, repMult: t.effect.repMult };
  if (t.effect.weeks > 0) data.retainer = { id: o.templateId, mentor: o.mentor, weekly: o.weekly, weeksLeft: t.effect.weeks };
  logEvent('offer', 'Accepted "' + t.title + '" from ' + o.mentor + '.');
  save(); emit('change');
  return o;
}

/* ---------------------------------------------------------
   SAMVIDHAN SAMACHAR (newspaper) — stable for the week
   --------------------------------------------------------- */
function buildNewspaper() {
  const rnd = mulberry32(data.week * 7919 + data.seed);
  const c = circuit();
  const recent = data.log.filter(e => e.type === 'win' || e.type === 'loss' || e.type === 'promotion').slice(-3).reverse();
  const headline = recent.length ? (recent[0].headline || recent[0].text.toUpperCase()) : 'NEW ADVOCATE ENROLS AT THE BAR';
  const col1 = [];
  if (recent.length) recent.forEach(e => col1.push({ h: e.type === 'promotion' ? 'ELEVATION' : 'COURT REPORT', p: e.text }));
  else col1.push({ h: 'BAR COUNCIL NOTES', p: 'Adv. ' + data.player.name + ' has joined the ' + c.name + '. Colleagues say the newcomer should spend time in the Bar Library before the first hearing.' });
  const newBns = pick(BNS.filter(b => b.ipc), rnd);
  col1.push({ h: 'LAW DESK: SECTION SPOTLIGHT', p: 'BNS ' + newBns.sec + ' (' + newBns.title + ')' + (newBns.ipc !== 'New' ? ', earlier ' + newBns.ipc + '. ' : '. ') + newBns.desc });
  const col2 = [];
  const lm = pick(CASES, rnd);
  col2.push({ h: 'LANDMARK OF THE WEEK', p: lm.name + ' (' + lm.year + '): ' + lm.holding });
  const ar = pick(ARTICLES.filter(a => a.n !== 'PRE'), rnd);
  col2.push({ h: 'ARTICLE OF THE DAY', p: 'Article ' + ar.n + ' — ' + ar.title + '. ' + ar.summary + ' Remember: ' + ar.tip });
  col2.push({ h: 'DID YOU KNOW?', p: pick(FACTS, rnd) });
  const L = data.learning;
  const ticker = 'Reputation ' + data.player.rep + '  •  ' + c.name + '  •  Study streak ' + L.streak + ' day(s)  •  ' + masteredCount(3) + ' items understood  •  Purse ₹' + data.player.purse.toLocaleString('en-IN');
  return { edition: 'WEEK ' + data.week, headline, col1, col2, ticker };
}

/* ---------------------------------------------------------
   PUBLIC API
   --------------------------------------------------------- */
SV.State = {
  get data() { return data; },
  get roster() { return roster; },
  get settings() { return settings; },

  on, off, emit,
  save, load, hasSave, eraseSave, newCareer,
  loadSettings, setSetting, applySettingsToCSS,

  // player
  circuit, rankTitle, maxHealth, maxFlow, isRoomUnlocked, courtLabel, getNpc, npcsBy, logEvent,
  roleLabel: r => ROLE_LABELS[r] || r,

  // learning
  getMastery, stars, masteredCount, recordAnswer, makeQuestion, makeQuestions, questionFromScenario,
  finishQuiz, getDailyChallenge, completeDaily, getLearningPath, getCodex,

  // career
  promotionStatus, checkPromotion, generateCase, resolveCase, advanceWeek,
  getOffers, acceptOffer, buildNewspaper
};

loadSettings();
if (global.document) {
  if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', applySettingsToCSS);
  else applySettingsToCSS();
}

})(typeof window !== 'undefined' ? window : globalThis);
