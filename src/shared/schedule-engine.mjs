// Shared pure scheduling engine. No task, persistence, or host side effects.
export const MINUTE = 60_000;
const DAY = 86_400_000;
const SEARCH_DAYS = 9 * 366; // Includes the longest Gregorian leap-day gap across a century.
const formats = new Map();
const MONTHS = Object.fromEntries('JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ').map((v, i) => [v, i + 1]));
const DAYS = Object.fromEntries('SUN MON TUE WED THU FRI SAT'.split(' ').map((v, i) => [v, i]));

export function effectiveZone(zone = '') {
  const name = zone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!formats.has(name)) {
    if (formats.size >= 32) formats.clear();
    formats.set(name, new Intl.DateTimeFormat('en-US-u-ca-iso8601-nu-latn', {
      timeZone: name, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }));
  }
  return name;
}

function wallEpoch({year, month, day, hour = 0, minute = 0, second = 0}) {
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  d.setUTCHours(hour, minute, second, 0);
  return d.getTime();
}
export function wallParts(epoch, zone = '') {
  const z = effectiveZone(zone);
  return Object.fromEntries(formats.get(z).formatToParts(epoch).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
}
function asCalendarDay(epoch) {
  const d = new Date(epoch);
  return {year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: d.getUTCDay()};
}
function offsetAt(epoch, zone) {
  const second = Math.floor(epoch / 1000) * 1000;
  return wallEpoch(wallParts(second, zone)) - second;
}
function offsetsNear(day, zone) {
  return [...new Set([-2,-1,-0.5,0,0.5,1,2].map(d => offsetAt(day + d * DAY, zone)))];
}
function wallToInstant(wall, zone, offsets) {
  // Reject nonexistent wall times; if a wall time repeats, choose its first actual instant.
  // The Intl round trip, not offset arithmetic alone, determines validity.
  const candidates = offsets.map(offset => wall - offset).filter(t => wallEpoch(wallParts(t, zone)) === wall);
  return candidates.length ? Math.min(...candidates) : null;
}
function dateParts(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text ?? '');
  if (!m) throw Error('日期格式应为 YYYY-MM-DD');
  const [year, month, day] = m.slice(1).map(Number);
  const actual = asCalendarDay(wallEpoch({year, month, day}));
  if (year < 1970 || year > 9999 || actual.year !== year || actual.month !== month || actual.day !== day) throw Error('日期无效');
  return {year, month, day};
}
function minuteOfDay(text) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text ?? '');
  if (!m) throw Error('时间格式应为 HH:mm');
  return Number(m[1]) * 60 + Number(m[2]);
}
function cronNumber(raw, aliases) {
  if (aliases && Object.hasOwn(aliases, raw.toUpperCase())) return aliases[raw.toUpperCase()];
  if (!/^\d+$/.test(raw)) throw Error('Cron 数值或名称无效');
  return Number(raw);
}
function cronField(text, min, max, aliases, distinct = max-min+1) {
  const values = new Set();
  let wildcard = false;
  for (const part of text.split(',')) {
    const pieces = part.split('/');
    if (!part || pieces.length > 2 || !pieces[0] || (pieces.length === 2 && !/^\d+$/.test(pieces[1]))) throw Error('Cron 字段无效');
    const step = pieces.length === 2 ? Number(pieces[1]) : 1;
    if (!Number.isSafeInteger(step) || step < 1 || step > distinct) throw Error('Cron 步长无效');
    const term = pieces[0];
    let lo, hi;
    if (term === '*') {
      lo = min; hi = max; wildcard = true;
    } else {
      const bounds = term.split('-');
      if (bounds.length > 2 || bounds.some(v => !v)) throw Error('Cron 范围无效');
      lo = cronNumber(bounds[0], aliases);
      hi = bounds.length === 2 ? cronNumber(bounds[1], aliases) : pieces.length === 2 ? max : lo;
    }
    if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hi) || lo < min || hi > max || hi < lo) throw Error('Cron 字段超出范围');
    for (let i=lo; i<=hi; i+=step) values.add(i);
  }
  if (!values.size) throw Error('Cron 字段不能为空');
  return {values, wildcard};
}

// 5-field POSIX/Vixie-style subset: lists, ranges, steps, names; no seconds, L/W/#, @ macros.
// DOM/DOW: if both are lexically restricted, either matches; otherwise both must match.
export function parseCron(expression) {
  const fields = String(expression ?? '').trim().split(/\s+/);
  if (fields.length !== 5 || fields[0] === '') throw Error('Cron 必须是 5 个字段');
  const mins=cronField(fields[0],0,59), hours=cronField(fields[1],0,23),
    dom=cronField(fields[2],1,31), month=cronField(fields[3],1,12,MONTHS), dow=cronField(fields[4],0,7,DAYS,7);
  const weekdays = new Set([...dow.values].map(n => n === 7 ? 0 : n));
  const times = [...hours.values].sort((a,b)=>a-b).flatMap(h => [...mins.values].sort((a,b)=>a-b).map(m=>h*60+m));
  return {
    times,
    dayMatches: p => month.values.has(p.month) && (!dom.wildcard && !dow.wildcard
      ? dom.values.has(p.day) || weekdays.has(p.weekday)
      : dom.values.has(p.day) && weekdays.has(p.weekday)),
  };
}
function calendarRule(schedule) {
  if (schedule.type === 'cron') return parseCron(schedule.cron);
  const times = [minuteOfDay(schedule.time)];
  switch (schedule.type) {
    case 'daily': return {times, dayMatches: () => true};
    case 'workdays': return {times, dayMatches: p=>p.weekday >= 1 && p.weekday <= 5};
    case 'weekly': {
      const days = new Set(schedule.days ?? []);
      if (!days.size || [...days].some(n=>!Number.isInteger(n)||n<0||n>6)) throw Error('请选择有效的星期');
      return {times, dayMatches:p=>days.has(p.weekday)};
    }
    case 'monthly': {
      const day = schedule.monthDay === 'last' ? 'last' : Number(schedule.monthDay);
      if (day !== 'last' && (!Number.isInteger(day) || day<1 || day>31)) throw Error('请选择有效的月日');
      return {times, dayMatches:p=>day==='last'
        ? new Date(wallEpoch({...p,month:p.month+1,day:0})).getUTCDate()===p.day
        : p.day===day};
    }
    default: throw Error('不支持的日程类型');
  }
}
function intervalPeriod(schedule) {
  const n = Number(schedule.minutes);
  if(!Number.isSafeInteger(n)||n<1||!Number.isSafeInteger(n*MINUTE)) throw Error('固定间隔至少为 1 分钟，且必须在有效数值范围内');
  return n * MINUTE;
}
export function resolveOnce(schedule) {
  if (Number.isSafeInteger(schedule.onceAt)) {
    if(!Number.isFinite(new Date(schedule.onceAt).getTime()))throw Error('指定执行时间超出有效日期范围');
    return schedule.onceAt;
  }
  const zone=effectiveZone(schedule.zone), parts=dateParts(schedule.date), day=wallEpoch(parts);
  const instant=wallToInstant(day+minuteOfDay(schedule.time)*MINUTE,zone,offsetsNear(day,zone));
  if(instant===null) throw Error('该本地时间不存在（时区切换），请选择其他时间');
  return instant;
}
function calendarOccurrence(schedule, epoch, direction) {
  const zone=effectiveZone(schedule.zone), from=wallParts(epoch,zone), start=wallEpoch({...from,hour:0,minute:0,second:0});
  const {times, dayMatches}=calendarRule(schedule);
  for(let d=0;d<=SEARCH_DAYS;d++){
    const day=start+direction*d*DAY, p=asCalendarDay(day);
    if(p.year<1970||p.year>9999) return null;
    if(!dayMatches(p))continue;
    const offsets=offsetsNear(day,zone);
    const list=direction===1?times:[...times].reverse();
    for(const minute of list){
      if(direction===1&&d===0&&minute<from.hour*60+from.minute)continue;
      const candidate=wallToInstant(day+minute*MINUTE,zone,offsets);
      if(candidate!==null&&(direction===1?candidate>epoch:candidate<=epoch))return candidate;
    }
  }
  return null;
}
export function nextOccurrence(schedule, epoch=Date.now()) {
  if (!schedule || !Number.isFinite(epoch)) return null;
  if(schedule.type==='interval'){
    const period=intervalPeriod(schedule), anchor=Number.isSafeInteger(schedule.anchor)?schedule.anchor:epoch;
    const next=anchor+Math.max(1,Math.floor((epoch-anchor)/period)+1)*period;
    if(!Number.isSafeInteger(next)||!Number.isFinite(new Date(next).getTime()))throw Error('下次执行超出有效日期范围');
    return next;
  }
  if(schedule.type==='once'){
    const instant=resolveOnce(schedule);
    return instant>epoch?instant:null;
  }
  return calendarOccurrence(schedule,epoch,1);
}
export function lastOccurrence(schedule, epoch) {
  if(schedule.type==='interval'){
    const period=intervalPeriod(schedule), anchor=schedule.anchor;
    if(!Number.isSafeInteger(anchor))throw Error('Interval anchor required');
    const n=Math.floor((epoch-anchor)/period);
    return n>=1?anchor+n*period:null;
  }
  if(schedule.type==='once'){
    const instant=resolveOnce(schedule);
    return instant<=epoch?instant:null;
  }
  return calendarOccurrence(schedule,epoch,-1);
}
export function previewOccurrences(schedule, epoch, limit=3) {
  const result=[];
  for(let i=0;i<limit;i++){
    const next=nextOccurrence(schedule, i ? result[i-1] : epoch);
    if(next===null)break;
    result.push(next);
  }
  return result;
}
export function validateSchedule(schedule, epoch=Date.now()) {
  try{
    if(!schedule)throw Error('请选择日程');
    effectiveZone(schedule.zone);
    const next=nextOccurrence(schedule,epoch);
    if(next===null)throw Error('没有有效的未来执行时间');
    return {ok:true,next};
  }catch(e){return {ok:false,error:e.message};}
}
export function occurrenceIdentity(schedule, due) {
  if(schedule.type==='interval'||schedule.type==='once')return `instant:${due}`;
  const p=wallParts(due,schedule.zone);
  // Following the host's zone does not give that day's same wall-clock slot a new identity.
  const z=schedule.zone ? formats.get(effectiveZone(schedule.zone)).resolvedOptions().timeZone : 'local';
  return `wall:${z}:${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function assessDeadline(due, now, graceMinutes, reason='tick', jitterMs=5000) {
  if(due>now)return 'not_due';
  if(due===now||reason==='tick'&&now-due<=jitterMs)return 'on_time';
  return graceMinutes>0&&now-due<=graceMinutes*MINUTE?'catch_up':'missed';
}
