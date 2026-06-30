// Rytterside-resultater (sæson-historik) — output fra scripts/snippets/pcs-rider.js
// Gem som: rider-{slug}.json  (fx rider-tadej-pogacar.json)
//
// SEPARAT mappe med vilje: disse filer har form { rider, results:[...] } og må IKKE
// ligge i fixtures/pcs/ (ingestPcs/buildWeb antager race-/etape-filer der).
// buildWeb læser denne mappe til form-bredde (når shapen er smoke-testet og bekræftet).
//
// SMOKE-TEST: kør pcs-rider.js på ÉN rytter, send output til Claude FØR hele
// startlisten (191 ryttere) hentes.
