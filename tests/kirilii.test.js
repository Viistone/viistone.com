const test = require('node:test');
const assert = require('node:assert');
const K = require('../assets/kirilii/engine.js');

const c = (id, v, s) => ({ id, v, s: s || 'S' });
function playOut(st, rnd) { let guard = 0; while (st.phase === 'play' && guard++ < 200) K.botMove(st, rnd); }
function setHands(st, hands, starter) {
  st.players.forEach((p, i) => { p.hand = hands[i] ? hands[i].slice() : []; p.played = []; p.out = !hands[i]; });
  st.turn = starter || 0; st.starter = starter || 0; st.last = null; st.lastBy = null; st.phase = 'play'; st.roundLog = [];
}

test('1. pakassa on 55 korttia', () => { assert.strictEqual(K.makeDeck().length, 55); });
test('2. pakassa on kaksi tavallista jokeria', () => { assert.strictEqual(K.makeDeck().filter(c => c.v === 15).length, 2); });
test('3. pakassa on yksi Ekstrajokka', () => { assert.strictEqual(K.makeDeck().filter(c => c.v === 16).length, 1); });
test('kortit ovat yksilöitäviä', () => { const ids = new Set(K.makeDeck().map(c => c.id)); assert.strictEqual(ids.size, 55); });
test('4. kuusi pelaajaa saa kuusi korttia', () => {
  const st = K.newGame({ seed: 1 });
  assert.strictEqual(st.players.length, 6);
  st.players.forEach(p => assert.strictEqual(p.hand.length, 6));
  const ids = new Set(st.players.flatMap(p => p.hand.map(c => c.id))); assert.strictEqual(ids.size, 36);
});
test('5. kortteja ei nosteta kesken kierroksen', () => {
  const st = K.newGame({ seed: 2 });
  let total = st.players.reduce((a, p) => a + p.hand.length + p.played.length, 0);
  for (let i = 0; i < 10; i++) { K.botMove(st, Math.random); const t = st.players.reduce((a, p) => a + p.hand.length + p.played.length, 0); assert.strictEqual(t, total); }
});
test('6. saa pelata samanarvoisen tai suuremman', () => {
  const h = [c(1, 3), c(2, 8), c(3, 9), c(4, 13)];
  const l = K.legal(h, 8).map(x => x.v); assert.deepStrictEqual(l.sort((a, b) => a - b), [3, 8, 9, 13]);
});
test('7. saa aina pelata pienimmän', () => {
  const h = [c(1, 3), c(2, 6), c(3, 9), c(4, 13), c(5, 14)];
  const l = K.legal(h, 8).map(x => x.v); assert.ok(l.includes(3)); assert.ok(!l.includes(6));
  assert.deepStrictEqual(K.legal([c(1, 2), c(2, 5)], 16).map(x => x.v), [2]);
});
test('8. useista pienimmistä saa valita', () => {
  const h = [c(1, 4, 'S'), c(2, 4, 'H'), c(3, 7)];
  const l = K.legal(h, 12).map(x => x.id); assert.deepStrictEqual(l.sort(), [1, 2]);
});
test('9. laitonta korttia ei voi pelata', () => {
  const st = K.newGame({ seed: 3 });
  setHands(st, [[c(1, 3), c(2, 6), c(3, 9), c(4, 13), c(5, 14), c(6, 2, 'H')], [c(11, 8), c(12, 10), c(13, 11), c(14, 12), c(15, 5), c(16, 7)]], 1);
  K.play(st, 1, 11); // 8
  assert.throws(() => K.play(st, 0, 2)); // 6 is not >= 8 and not the lowest (2 is)
  assert.throws(() => K.play(st, 1, 12), /not your turn/);
});
test('10. viimeksi pelattu kortti ohjaa seuraavaa', () => {
  const st = K.newGame({ seed: 4 });
  setHands(st, [[c(1, 5), c(2, 6), c(3, 7)], [c(11, 14), c(12, 3), c(13, 4)], [c(21, 2), c(22, 9), c(23, 10)]], 0);
  K.play(st, 0, 3); assert.strictEqual(st.last, 7);
  K.play(st, 1, 12); assert.strictEqual(st.last, 3, 'lower card becomes the new reference');
  assert.deepStrictEqual(K.legal(st.players[2].hand, st.last).map(x => x.v).sort((a, b) => a - b), [2, 9, 10]);
});
test('11. kortit sijoitetaan pelaajakohtaisesti', () => {
  const st = K.newGame({ seed: 5 });
  const p = st.turn; K.botMove(st, Math.random);
  assert.strictEqual(st.players[p].played.length, 1);
  st.players.forEach(q => { if (q.id !== p) assert.strictEqual(q.played.length, 0); });
});
test('12. kierros päättyy kun kaikilla yksi kortti', () => {
  const st = K.newGame({ seed: 6 });
  let plays = 0; while (st.phase === 'play') { K.botMove(st, Math.random); plays++; }
  assert.strictEqual(plays, 30);
  st.players.forEach(p => { assert.strictEqual(p.hand.length, 1); assert.strictEqual(p.played.length, 5); });
});
test('13. vain korkeimman haltija saa pisteitä ja 15. arvot oikein', () => {
  const st = K.newGame({ seed: 7 });
  setHands(st, [[c(1, 2), c(2, 3)], [c(11, 4), c(12, 14)], [c(21, 5), c(22, 9)]], 0);
  K.play(st, 0, 2); K.play(st, 1, 11); K.play(st, 2, 22); // 0 keeps 2, 1 keeps A, 2 keeps 5
  assert.strictEqual(st.phase, 'reveal');
  assert.deepStrictEqual(st.result.losers, [1]); assert.strictEqual(st.players[1].pts, 14); assert.strictEqual(st.players[0].pts, 0);
});
test('14. tasatilanteessa kaikki korkeimmat saavat pisteet', () => {
  const st = K.newGame({ seed: 8 });
  setHands(st, [[c(1, 2), c(2, 13, 'S')], [c(11, 4), c(12, 13, 'H')], [c(21, 5), c(22, 9)]], 0);
  K.play(st, 0, 1); K.play(st, 1, 11); K.play(st, 2, 22);
  assert.deepStrictEqual(st.result.losers.sort(), [0, 1]); assert.strictEqual(st.players[0].pts, 13); assert.strictEqual(st.players[1].pts, 13);
});
test('16. putoaa 21 pisteessä', () => {
  const st = K.newGame({ seed: 9 });
  st.players[1].pts = 8; st.players[2].pts = 7;
  setHands(st, [[c(1, 2), c(2, 3)], [c(11, 4), c(12, 13)], [c(21, 5), c(22, 9)]], 0);
  st.players.forEach((p, i) => { if (i > 2) { p.out = true; } });
  K.play(st, 0, 2); K.play(st, 1, 11); K.play(st, 2, 22);
  assert.strictEqual(st.players[1].pts, 21); assert.strictEqual(st.players[1].out, true);
});
test('17. heads up alkaa kahdella ja 18. peli päättyy yhteen', () => {
  const st = K.newGame({ seed: 10 });
  st.players.forEach((p, i) => { if (i > 2) p.out = true; });
  st.players[2].pts = 20;
  setHands(st, [[c(1, 2), c(2, 3)], [c(11, 4), c(12, 5)], [c(21, 6), c(22, 9)]], 0);
  st.players.forEach((p, i) => { if (i > 2) p.out = true; });
  K.play(st, 0, 2); K.play(st, 1, 11); K.play(st, 2, 21);
  assert.strictEqual(st.players[2].out, true); assert.strictEqual(st.result.headsUp, true); assert.strictEqual(st.headsUp, true);
  // finish it: player 1 goes over
  st.players[1].pts = 20; K.nextRound(st);
  setHands(st, [[c(1, 2), c(2, 3)], [c(11, 4), c(12, 9)]], 0);
  st.players.forEach((p, i) => { if (i > 1) p.out = true; });
  K.play(st, 0, 2); K.play(st, 1, 11);
  assert.strictEqual(st.phase, 'over'); assert.strictEqual(st.winner, 0);
});
test('kaikki yli rajan: pienin kokonaispiste säilyy', () => {
  const st = K.newGame({ seed: 11 });
  st.players.forEach((p, i) => { if (i > 1) p.out = true; });
  st.players[0].pts = 15; st.players[1].pts = 18;
  setHands(st, [[c(1, 2), c(2, 13, 'S')], [c(11, 4), c(12, 13, 'H')]], 0);
  st.players.forEach((p, i) => { if (i > 1) p.out = true; });
  K.play(st, 0, 1); K.play(st, 1, 11);
  assert.strictEqual(st.players[0].out, false); assert.strictEqual(st.players[1].out, true); assert.strictEqual(st.winner, 0);
});
test('19. höyläys tunnistetaan', () => {
  // A saves an ace; B has 4 and K at the end. A plays the ace right before B, B must drop the 4, keeps K and loses.
  const st = K.newGame({ seed: 12 });
  setHands(st, [
    [c(1, 2), c(2, 3), c(3, 4, 'H'), c(4, 14)],      // A (0)
    [c(11, 5), c(12, 6), c(13, 4), c(14, 13)],       // B (1)
    [c(21, 2, 'H'), c(22, 3, 'H'), c(23, 5, 'H'), c(24, 7)] // C (2)
  ], 0);
  K.play(st, 0, 1);  // A 2
  K.play(st, 1, 11); // B 5
  K.play(st, 2, 24); // C 7
  K.play(st, 0, 2);  // A 3 (lowest)
  K.play(st, 1, 12); // B 6
  K.play(st, 2, 21); // C 2 (lowest)
  K.play(st, 0, 4);  // A ace!
  K.play(st, 1, 13); // B forced 4, keeps K
  K.play(st, 2, 22); // C 3, keeps 5
  assert.strictEqual(st.phase, 'reveal');
  assert.deepStrictEqual(st.result.losers, [1]);
  assert.strictEqual(st.result.hoyla.length, 1); assert.strictEqual(st.result.hoyla[0].by, 0); assert.strictEqual(st.result.hoyla[0].mcbueno, false);
});
test('pelkkä iso kortti ei ole höyläys', () => {
  const st = K.newGame({ seed: 13 });
  setHands(st, [[c(1, 2), c(2, 14)], [c(11, 5), c(12, 13)], [c(21, 6), c(22, 3)]], 0);
  K.play(st, 0, 2); // A plays ace first: B can still play K
  K.play(st, 1, 11); // B chooses 5 (lowest), keeps K by own choice -> n=1 so not late
  K.play(st, 2, 22);
  assert.deepStrictEqual(st.result.losers, [1]); assert.strictEqual(st.result.hoyla.length, 0);
});
test('20. McBueno tunnistetaan', () => {
  const st = K.newGame({ seed: 14 });
  const A = [c(1, 2), c(2, 3), c(3, 4, 'H'), c(4, 5, 'H'), c(5, 16, 'X'), c(6, 2, 'D')];
  const B = [c(11, 6), c(12, 7), c(13, 8), c(14, 9), c(15, 3, 'C'), c(16, 14)];
  setHands(st, [A, B], 0);
  st.players.forEach((p, i) => { if (i > 1) p.out = true; });
  K.play(st, 0, 1); K.play(st, 1, 15); // 2, 3
  K.play(st, 0, 2); K.play(st, 1, 11); // 3, 6
  K.play(st, 0, 6); K.play(st, 1, 12); // 2(lowest), 7
  K.play(st, 0, 3); K.play(st, 1, 13); // 4(lowest), 8
  K.play(st, 0, 5); K.play(st, 1, 14); // EKSTRAJOKKA (A's 5th), B forced 9, keeps ace
  assert.deepStrictEqual(st.result.losers, [1]);
  assert.strictEqual(st.result.hoyla.length, 1); assert.strictEqual(st.result.hoyla[0].mcbueno, true);
});
test('21. botit eivät näe piilokortteja', () => {
  const st = K.newGame({ seed: 15 });
  const v = K.view(st, 2);
  v.players.forEach(p => { assert.strictEqual(p.hand, undefined); });
  assert.ok(!JSON.stringify(v).includes('"hand":[{') || v.hand.length === 6);
  const others = st.players.filter(p => p.id !== 2).flatMap(p => p.hand.map(c => c.id));
  const seen = JSON.stringify(v);
  others.forEach(id => assert.ok(!new RegExp('"id":' + id + ',').test(JSON.stringify(v.hand))));
  assert.ok(seen.length > 0);
});
test('botit pelaavat aina laillisesti kaikilla tasoilla', () => {
  ['easy', 'normal', 'hard'].forEach(d => {
    const st = K.newGame({ seed: 20, difficulty: d });
    let rounds = 0;
    while (st.phase !== 'over' && rounds < 60) { while (st.phase === 'play') K.botMove(st, Math.random); rounds++; K.nextRound(st); }
    assert.strictEqual(st.phase, 'over', d + ' game finished'); assert.ok(st.winner != null);
  });
});
test('22. tallennettu peli palautuu', () => {
  const st = K.newGame({ seed: 16 });
  for (let i = 0; i < 7; i++) K.botMove(st, Math.random);
  const back = K.load(K.save(st));
  assert.deepStrictEqual(back, JSON.parse(JSON.stringify(st)));
  K.botMove(back, Math.random); assert.strictEqual(back.roundLog.length, 8);
});
