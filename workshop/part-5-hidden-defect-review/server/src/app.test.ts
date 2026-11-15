import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { buildApp } from './app.js';
import { detailSchema, listSchema } from '../../shared/auction.js';

const app = buildApp();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://auction:auction@localhost:55432/auction_part_5' });
const created: string[] = [];
const listing = () => ({ title: '  Integration test GPU  ', category: 'GPUs', description: ' Tested equipment. ', condition: 'Used', location: ' Austin, TX ', startingPriceCents: 12345, closesAt: new Date(Date.now()+3600000).toISOString() });
async function post(body: Record<string, unknown>, user = '2') {
  const response = await app.inject({ method: 'POST', url: '/api/auctions', headers: { 'x-demo-user-id': user }, payload: body });
  if (response.statusCode === 201) created.push(response.json<{ slug: string }>().slug);
  return response;
}
afterAll(async () => {
  await pool.query('DELETE FROM auctions WHERE slug=ANY($1::text[])', [created]);
  await app.close(); await pool.end();
});

describe('persisted auction browsing and posting', () => {
  it('reports PostgreSQL health and correlation ID', async () => {
    const response = await app.inject({ url: '/api/health', headers: { 'x-request-id': 'part2-check' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, db: 'ok', requestId: 'part2-check' });
    expect(response.headers['x-request-id']).toBe('part2-check');
  });
  it('lists ten seeded users and six seed auctions with consistent bid histories', async () => {
    const users = (await app.inject('/api/users')).json().users;
    expect(users).toHaveLength(10);
    const auctions = listSchema.parse((await app.inject('/api/auctions')).json()).auctions;
    const seeds = ['nvidia-h100-sxm-80gb','amd-epyc-9654','one-point-five-tb-ddr5-ecc','supermicro-4u-gpu-chassis','quantum-2-400g-switch','direct-to-chip-cooling-loop'];
    const prices = [1845000,472500,689000,212000,1275000,98000];
    const counts = [22,14,31,9,18,7];
    for (const [index,slug] of seeds.entries()) {
      expect(auctions.some(a => a.slug === slug)).toBe(true);
      const detail = detailSchema.parse((await app.inject(`/api/auctions/${slug}`)).json());
      expect(detail.bids.length).toBeGreaterThanOrEqual(counts[index]);
      expect(detail.auction.bidCount).toBe(detail.bids.length);
      expect(detail.auction.currentAmountCents).toBeGreaterThanOrEqual(prices[index]);
      expect(detail.bids[0].amountCents).toBe(detail.auction.currentAmountCents);
      for (const [i,bid] of detail.bids.entries()) {
        expect(bid.bidder.id).not.toBe(detail.auction.seller.id);
        if (i) { expect(Date.parse(bid.createdAt)).toBeLessThanOrEqual(Date.parse(detail.bids[i-1].createdAt)); expect(bid.amountCents).toBeLessThan(detail.bids[i-1].amountCents); }
      }
    }
  });
  it('creates, persists and reads a trimmed listing attributed to the selected seller', async () => {
    const response = await post(listing());
    expect(response.statusCode).toBe(201);
    const { slug } = response.json();
    expect(response.headers.location).toBe(`/api/auctions/${slug}`);
    const detail = detailSchema.parse((await app.inject(`/api/auctions/${slug}`)).json());
    expect(detail.auction).toMatchObject({title:'Integration test GPU',description:'Tested equipment.',location:'Austin, TX',startingPriceCents:12345,currentAmountCents:12345,bidCount:0,seller:{id:2},specs:[],currentBidder:null,ended:false});
    expect(detail.bids).toEqual([]);
    // Other integration files create auctions concurrently; scope this ordering check.
    const catalog = listSchema.parse((await app.inject('/api/auctions?sort=newest&q=Integration%20test%20GPU')).json());
    expect(catalog.auctions[0].slug).toBe(slug);
    const stored = (await pool.query('SELECT starting_price_cents,closes_at FROM auctions WHERE slug=$1',[slug])).rows[0];
    expect(stored.starting_price_cents).toBe(12345);
    expect(stored.closes_at.toISOString()).toBe(detail.auction.closesAt);
    const secondApp = buildApp();
    try { expect((await secondApp.inject(`/api/auctions/${slug}`)).statusCode).toBe(200); } finally { await secondApp.close(); }
  });
  it.each([1, 100_000_000])('posts the allowed starting price boundary of %i cents', async startingPriceCents => {
    const response = await post({ ...listing(), startingPriceCents });
    expect(response.statusCode).toBe(201);
    const detail = detailSchema.parse((await app.inject(`/api/auctions/${response.json<{slug: string}>().slug}`)).json());
    expect(detail.auction.startingPriceCents).toBe(startingPriceCents);
    expect(detail.auction.currentAmountCents).toBe(startingPriceCents);
  });
  it('uses the selected demo seller and ignores supplied ownership and bid state', async () => {
    const response = await post({ ...listing(), sellerId: 9, seller_id: 9, currentAmountCents: 1, bidCount: 100, specs: [['Fake', 'Value']] }, '4');
    expect(response.statusCode).toBe(201);
    const detail = detailSchema.parse((await app.inject(`/api/auctions/${response.json<{slug: string}>().slug}`)).json());
    expect(detail.auction).toMatchObject({seller:{id:4},startingPriceCents:12345,currentAmountCents:12345,bidCount:0,specs:[]});
    expect(detail.bids).toEqual([]);
  });
  it('preserves Unicode and punctuation and gives duplicate titles distinct detail URLs', async () => {
    const title = `O'Brien GPU · 二 ${randomUUID()}`;
    const first = await post({...listing(), title});
    const second = await post({...listing(), title});
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const firstSlug = first.json<{slug:string}>().slug;
    const secondSlug = second.json<{slug:string}>().slug;
    expect(firstSlug).not.toBe(secondSlug);
    for (const slug of [firstSlug,secondSlug]) {
      const detail = detailSchema.parse((await app.inject(`/api/auctions/${slug}`)).json());
      expect(detail.auction.title).toBe(title);
    }
  });
  it.each([64, 120])('opens and accepts bids on a listing with a %i-character title', async length => {
    const response = await post({ ...listing(), title: 'x'.repeat(length) });
    expect(response.statusCode).toBe(201);
    const { slug } = response.json<{ slug: string }>();
    expect(slug.length).toBeGreaterThan(100);
    const detail = detailSchema.parse((await app.inject(`/api/auctions/${slug}`)).json());
    expect(detail.auction.title).toBe('x'.repeat(length));
    const accepted = await app.inject({ method: 'POST', url: `/api/auctions/${slug}/bids`,
      headers: { 'x-demo-user-id': '3' }, payload: { amountCents: 12445 } });
    expect(accepted.statusCode).toBe(201);
    const updated = detailSchema.parse((await app.inject(`/api/auctions/${slug}`)).json());
    expect(updated.auction.bidCount).toBe(1);
    expect(updated.bids[0].amountCents).toBe(12445);
  });
  it('searches literal text and filters and sorts alongside additional saved listings', async () => {
    const token = randomUUID();
    const fixtureSlugs: string[] = [];
    for (const [title, category] of [
      [`NVIDIA ${token}% GPU`, 'GPUs'],
      [`NVIDIA ${token} GPU`, 'GPUs'],
      [`NVIDIA ${token}% network card`, 'Networking'],
    ]) {
      const response = await post({ ...listing(), title, category });
      expect(response.statusCode).toBe(201);
      fixtureSlugs.push(response.json<{ slug: string }>().slug);
    }
    const result = listSchema.parse((await app.inject('/api/auctions?q=NVIDIA&category=GPUs')).json());
    expect(result.auctions.map(a => a.slug)).toEqual(expect.arrayContaining(['nvidia-h100-sxm-80gb', ...fixtureSlugs.slice(0, 2)]));
    for (const auction of result.auctions) {
      expect(auction.category).toBe('GPUs');
      expect(`${auction.title} ${auction.category} ${auction.kicker} ${auction.description}`.toLowerCase()).toContain('nvidia');
    }
    const literalQuery = new URLSearchParams({ q: `NVIDIA ${token}%`, category: 'GPUs' });
    const literalResult = listSchema.parse((await app.inject(`/api/auctions?${literalQuery}`)).json());
    expect(literalResult.auctions.map(a => a.slug)).toEqual([fixtureSlugs[0]]);
    for (const sort of ['price-asc','price-desc','newest','closing']) {
      const rows = listSchema.parse((await app.inject(`/api/auctions?sort=${sort}`)).json()).auctions;
      const values = rows.map(a => sort.startsWith('price') ? a.currentAmountCents : Date.parse(sort === 'newest' ? a.createdAt : a.closesAt));
      expect(values).toEqual([...values].sort((a,b) => sort === 'price-desc' || sort === 'newest' ? b-a : a-b));
    }
  });
  it.each([
    {title:'   '},{title:'x'.repeat(121)},{description:''},{description:'x'.repeat(5001)},
    {location:''},{location:'x'.repeat(121)},{category:'Other'},{condition:'Broken'},
    {startingPriceCents:0},{startingPriceCents:100000001},{startingPriceCents:1.5},{startingPriceCents:'100'},
    {closesAt:'tomorrow'},{closesAt:'2020-01-01T00:00:00Z'},{closesAt:'2030-01-01T00:00'},
  ])('rejects invalid fields %j', async override => { expect((await post({...listing(),...override})).statusCode).toBe(400); });
  it('reports the auction price cap instead of JavaScript integer limits for enormous amounts', async () => {
    const response = await post({...listing(), startingPriceCents: 1e40});
    expect(response.statusCode).toBe(400);
    expect(response.json().issues).toContainEqual(expect.objectContaining({path:['startingPriceCents'],message:'The starting price must be at most $1,000,000.'}));
    expect(response.body).not.toContain('9007199254740991');
  });
  it.each(['2027-02-31T14:30:00Z','2020-02-31T14:30:00Z'])('categorizes impossible calendar date %s as invalid rather than past', async closesAt => {
    const response = await post({...listing(), closesAt});
    expect(response.statusCode).toBe(400);
    expect(response.json().issues).toEqual([expect.objectContaining({path:['closesAt'],message:'Enter a valid closing date and time.'})]);
  });
  it('only asks for a future date when the supplied calendar date is valid', async () => {
    const response = await post({...listing(), closesAt:'2020-02-28T14:30:00Z'});
    expect(response.statusCode).toBe(400);
    expect(response.json().issues).toEqual([expect.objectContaining({path:['closesAt'],message:'Choose a future closing date and time.'})]);
  });
  it('rejects missing or invalid demo users', async () => {
    const invalidUserListing = { ...listing(), title: `Rejected user ${randomUUID()}` };
    expect((await app.inject({method:'POST',url:'/api/auctions',payload:invalidUserListing})).statusCode).toBe(400);
    for (const user of ['0','11','abc','1.5']) expect((await post(invalidUserListing,user)).statusCode).toBe(400);
    expect((await pool.query('SELECT count(*)::int AS count FROM auctions WHERE title=$1',[invalidUserListing.title])).rows[0].count).toBe(0);
  });
  it('enforces sequential bidding rules and persists newest-first history', async () => {
    const posted=await post({...listing(),startingPriceCents:10000});const slug=posted.json<{slug:string}>().slug;
    const bid=(amountCents:unknown,user='3')=>app.inject({method:'POST',url:`/api/auctions/${slug}/bids`,headers:{'x-demo-user-id':user},payload:{amountCents}});
    expect((await bid(10100,'2')).statusCode).toBe(403);
    for(const amount of [10000,10099]) expect((await bid(amount)).statusCode).toBe(409);
    for(const amount of [-1,1.5,'10100',1e40]) expect((await bid(amount)).statusCode).toBe(400);
    expect((await bid(10100,'11')).statusCode).toBe(400);
    expect((await bid(10100)).statusCode).toBe(201);
    expect((await bid(10100,'4')).statusCode).toBe(409);
    expect((await bid(10200)).statusCode).toBe(201);
    const detail=detailSchema.parse((await app.inject(`/api/auctions/${slug}`)).json());
    expect(detail.auction).toMatchObject({currentAmountCents:10200,bidCount:2,currentBidder:{id:3}});
    expect(detail.bids.map(b=>b.amountCents)).toEqual([10200,10100]);
    await pool.query("UPDATE auctions SET closes_at=clock_timestamp()-interval '1 second' WHERE slug=$1",[slug]);
    expect((await bid(10300,'4')).statusCode).toBe(409);
    expect(detailSchema.parse((await app.inject(`/api/auctions/${slug}`)).json()).bids).toHaveLength(2);
    expect((await app.inject({method:'POST',url:'/api/auctions/no-such-auction/bids',headers:{'x-demo-user-id':'3'},payload:{amountCents:10100}})).statusCode).toBe(404);
  });
  it('returns useful errors for invalid catalog filters and missing details', async () => {
    expect((await app.inject('/api/auctions?sort=unsafe')).statusCode).toBe(400);
    expect((await app.inject('/api/auctions?category=Other')).statusCode).toBe(400);
    expect((await app.inject('/api/auctions/missing-auction')).statusCode).toBe(404);
  });
  it('retains ended listings and their bid history', async () => {
    const response = await post(listing()); const {slug}=response.json();
    await pool.query("UPDATE auctions SET closes_at=now()-interval '1 second' WHERE slug=$1",[slug]);
    const detail = detailSchema.parse((await app.inject(`/api/auctions/${slug}`)).json());
    expect(detail.auction.ended).toBe(true);
    expect(listSchema.parse((await app.inject('/api/auctions')).json()).auctions.some(a => a.slug===slug)).toBe(true);
  });
});
