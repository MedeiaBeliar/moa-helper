import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {statisticsFromCounts} from '../public/community.js';

const fail=message=>{throw Object.assign(new Error(message),{status:400});};
export function validateContribution(input,catalogue){
  if(!input||typeof input!=='object'||Object.keys(input).some(key=>!['token','revision','counts'].includes(key)))fail('Invalid submission');
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.token))fail('Invalid contributor token');
  if(!Number.isSafeInteger(input.revision)||input.revision<1||input.revision>1e9)fail('Invalid revision');
  if(!Array.isArray(input.counts)||input.counts.length>(catalogue.length+1)*6)fail('Invalid counts');
  const known=new Set(catalogue.map(block=>block.id)),keys=new Set();let total=0;
  const counts=input.counts.map(row=>{
    if(!row||Object.keys(row).some(key=>!['blockId','stage','normal','reroll'].includes(key))||row.blockId!==null&&!known.has(row.blockId))fail('Unknown shape');
    if(!Number.isInteger(row.stage)||row.stage<0||row.stage>5||![row.normal,row.reroll].every(n=>Number.isSafeInteger(n)&&n>=0))fail('Invalid count');
    total+=row.normal+row.reroll;const key=JSON.stringify([row.blockId,row.stage]);if(keys.has(key))fail('Duplicate count');keys.add(key);
    return {blockId:row.blockId,stage:row.stage,normal:row.normal,reroll:row.reroll};
  });
  if(total>1e6)fail('Contributor limit exceeded');
  return {hash:createHash('sha256').update(input.token.toLowerCase()).digest('hex'),revision:input.revision,counts};
}

export class StatisticsStore {
  constructor(filename,catalogue){
    this.catalogue=catalogue;this.db=new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS contributors (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, counts TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS totals (block_id TEXT NOT NULL, stage INTEGER NOT NULL, normal INTEGER NOT NULL CHECK(normal>=0), reroll INTEGER NOT NULL CHECK(reroll>=0), PRIMARY KEY(block_id,stage));
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    this.lookup=this.db.prepare('SELECT revision,counts FROM contributors WHERE id=?');
    this.delta=this.db.prepare('INSERT INTO totals VALUES (?,?,?,?) ON CONFLICT(block_id,stage) DO UPDATE SET normal=normal+excluded.normal,reroll=reroll+excluded.reroll');
    this.update=this.db.prepare('INSERT INTO contributors VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,counts=excluded.counts');
    this.updated=this.db.prepare("INSERT INTO metadata VALUES ('updatedAt',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  }
  read(){
    const counts=this.db.prepare('SELECT block_id AS blockId,stage,normal,reroll FROM totals WHERE normal>0 OR reroll>0 ORDER BY block_id,stage').all().map(row=>({...row,blockId:row.blockId||null}));
    return {statistics:statisticsFromCounts(counts,this.catalogue),updatedAt:this.db.prepare("SELECT value FROM metadata WHERE key='updatedAt'").get()?.value??null};
  }
  submit(input){
    const clean=validateContribution(input,this.catalogue);
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const previous=this.lookup.get(clean.hash);
      if(previous&&previous.revision>=clean.revision){this.db.exec('COMMIT');return this.read();}
      const changes=new Map();
      for(const [sign,rows]of [[-1,previous?JSON.parse(previous.counts):[]],[1,clean.counts]])for(const row of rows){
        const key=JSON.stringify([row.blockId,row.stage]),change=changes.get(key)||{...row,normal:0,reroll:0};
        change.normal+=sign*row.normal;change.reroll+=sign*row.reroll;changes.set(key,change);
      }
      // Use UPDATE for negative deltas: SQLite checks an INSERT before its
      // conflict handler, even when the final aggregate would be nonnegative.
      const existing=this.db.prepare('SELECT 1 FROM totals WHERE block_id=? AND stage=?');
      const adjust=this.db.prepare('UPDATE totals SET normal=normal+?,reroll=reroll+? WHERE block_id=? AND stage=?');
      for(const row of changes.values())if(row.normal||row.reroll){
        if(existing.get(row.blockId||'',row.stage))adjust.run(row.normal,row.reroll,row.blockId||'',row.stage);
        else this.delta.run(row.blockId||'',row.stage,row.normal,row.reroll);
      }
      this.update.run(clean.hash,clean.revision,JSON.stringify(clean.counts));this.updated.run(new Date().toISOString());
      this.db.exec('COMMIT');return this.read();
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  close(){this.db.close();}
}
