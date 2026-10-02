// Independent end-state audit: no solver or simulator code is imported here.
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const filenames=process.argv.slice(2);
assert.ok(filenames.length,'Pass completed full-game JSON reports, not progress files.');
const {catalogue}=JSON.parse(await readFile(new URL('./fixtures/observed-draws.json',import.meta.url),'utf8'));
function hasPlacement(board,cells){
  for(const flip of [1,-1]){
    let points=cells.map(([x,y])=>[flip*x,y]);
    for(let turn=0;turn<4;turn++){
      const minX=Math.min(...points.map(p=>p[0])),minY=Math.min(...points.map(p=>p[1]));
      const shape=points.map(([x,y])=>[x-minX,y-minY]);
      const width=1+Math.max(...shape.map(p=>p[0])),height=1+Math.max(...shape.map(p=>p[1]));
      for(let y=0;y<=board.length-height;y++)for(let x=0;x<=10-width;x++)
        if(shape.every(([dx,dy])=>(board[y+dy]&(2**(x+dx)))===0))return true;
      points=points.map(([x,y])=>[y,-x]);
    }
  }
  return false;
}
for(const filename of filenames){
  const data=JSON.parse(await readFile(filename,'utf8'));
  assert.ok(data.reports?.length,'No completed games: an in-progress score is not a final result.');
  for(const r of data.reports){
    assert.equal(r.status,'dead');assert.equal(r.deathVerified,true);
    assert.equal(r.skills.dot+r.skills.reroll,0);assert.ok(r.remaining.length);
    for(const name of r.remaining){
      const matches=catalogue.filter(p=>p.name===name);assert.equal(matches.length,1,'Ambiguous final shape identity');
      assert.equal(hasPlacement(r.board,matches[0].cells),false,`${name} still has a legal placement`);
    }
    const occupied=r.board.reduce((s,row)=>s+row.toString(2).replaceAll('0','').length,0);
    // These archived runs predate the confirmed +1 point for dot placements.
    assert.equal(r.placementScore+r.dotsUsed,r.lines*10+occupied);
    assert.equal(r.skillsAcquired,r.dotsUsed+r.rerollsUsed);
    assert.equal(r.acquisitionScore,r.skillsAcquired*50);
    assert.equal(r.rawScore,r.placementScore+r.lineScore+r.acquisitionScore);
    assert.equal(r.score,Math.min(500000,r.rawScore));
    const perBatch=new Map();for(const t of r.trace)perBatch.set(t.batch,(perBatch.get(t.batch)||0)+(t.decisionElapsedMs??t.elapsedMs));
    console.log(JSON.stringify({filename,variant:r.variant,seed:r.seed,deathAudit:'passed',score:r.score,completedBatches:r.completedBatches,fallbacks:r.fallbacks,
      maxRecommendationMs:r.timing.maxMs,maxBatchCumulativeMs:Math.max(0,...perBatch.values()),batchTimingIncludesFallback:r.trace.every(t=>'decisionElapsedMs'in t)}));
  }
}
