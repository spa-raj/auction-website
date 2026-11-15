CREATE TABLE demo_users (
  id integer PRIMARY KEY,
  name text NOT NULL UNIQUE
);
CREATE TABLE auctions (
  slug text PRIMARY KEY,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  category text NOT NULL CHECK (category IN ('GPUs','CPUs','Memory','Chassis','Networking','Cooling')),
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 5000),
  condition text NOT NULL,
  location text NOT NULL CHECK (length(trim(location)) BETWEEN 1 AND 120),
  starting_price_cents integer NOT NULL CHECK (starting_price_cents BETWEEN 1 AND 100000000),
  seller_id integer NOT NULL REFERENCES demo_users(id),
  closes_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  kicker text NOT NULL DEFAULT '',
  specs jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE TABLE bids (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  auction_slug text NOT NULL REFERENCES auctions(slug) ON DELETE CASCADE,
  bidder_id integer NOT NULL REFERENCES demo_users(id),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bids_auction_history ON bids(auction_slug, created_at DESC, id DESC);
INSERT INTO demo_users (id,name) VALUES (1,'North Loop Compute');
INSERT INTO demo_users (id,name) VALUES (2,'Decommissioned Dreams');
INSERT INTO demo_users (id,name) VALUES (3,'Heap & Sons');
INSERT INTO demo_users (id,name) VALUES (4,'Bare Metal Matchmakers');
INSERT INTO demo_users (id,name) VALUES (5,'Layer Eight Supply');
INSERT INTO demo_users (id,name) VALUES (6,'Cool Story Systems');
INSERT INTO demo_users (id,name) VALUES (7,'tensor_tamer');
INSERT INTO demo_users (id,name) VALUES (8,'thread_ripper_47');
INSERT INTO demo_users (id,name) VALUES (9,'segfault_sally');
INSERT INTO demo_users (id,name) VALUES (10,'packet_wrangler');
INSERT INTO auctions (slug,title,category,description,condition,location,starting_price_cents,seller_id,closes_at,created_at,kicker,specs) VALUES ('nvidia-h100-sxm-80gb','NVIDIA H100 SXM 80GB','GPUs','A production-pulled H100 accelerator with a clean diagnostic report. It spent its first career training recommendation models and is ready for something more interesting.','Used · Fully tested','Minneapolis, MN',1842800,1,now()+interval '134 minutes',now()-interval '6 days','Retired from a very serious rack','[["Memory", "80GB HBM3"], ["Interface", "SXM5"], ["TDP", "700W"], ["Included", "Protective carrier"]]'::jsonb);
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('nvidia-h100-sxm-80gb',8,1842900,now()-interval '22 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('nvidia-h100-sxm-80gb',9,1843000,now()-interval '21 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('nvidia-h100-sxm-80gb',10,1843100,now()-interval '20 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('nvidia-h100-sxm-80gb',7,1843200,now()-interval '19 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('nvidia-h100-sxm-80gb',8,1843300,now()-interval '18 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('nvidia-h100-sxm-80gb',9,1843400,now()-interval '17 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('nvidia-h100-sxm-80gb',10,1843500,now()-interval '16 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('nvidia-h100-sxm-80gb',7,1843600,now()-interval '15 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('nvidia-h100-sxm-80gb',8,1843700,now()-interval '14 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('nvidia-h100-sxm-80gb',9,1843800,now()-interval '13 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('nvidia-h100-sxm-80gb',10,1843900,now()-interval '12 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('nvidia-h100-sxm-80gb',7,1844000,now()-interval '11 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('nvidia-h100-sxm-80gb',8,1844100,now()-interval '10 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('nvidia-h100-sxm-80gb',9,1844200,now()-interval '9 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('nvidia-h100-sxm-80gb',10,1844300,now()-interval '8 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('nvidia-h100-sxm-80gb',7,1844400,now()-interval '7 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('nvidia-h100-sxm-80gb',8,1844500,now()-interval '6 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('nvidia-h100-sxm-80gb',9,1844600,now()-interval '5 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('nvidia-h100-sxm-80gb',10,1844700,now()-interval '4 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('nvidia-h100-sxm-80gb',7,1844800,now()-interval '3 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('nvidia-h100-sxm-80gb',8,1844900,now()-interval '2 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('nvidia-h100-sxm-80gb',9,1845000,now()-interval '1 minutes');
INSERT INTO auctions (slug,title,category,description,condition,location,starting_price_cents,seller_id,closes_at,created_at,kicker,specs) VALUES ('amd-epyc-9654','AMD EPYC 9654 · 96 cores','CPUs','Ninety-six Zen 4 cores looking for a loving socket. Removed during a capacity refresh, cleaned, inspected, and tested under sustained all-core load.','Open box · Bench tested','Columbus, OH',471100,2,now()+interval '348 minutes',now()-interval '5 days','Has seen things. Mostly Kubernetes.','[["Cores / threads", "96 / 192"], ["Base clock", "2.4 GHz"], ["Socket", "SP5"], ["L3 cache", "384MB"]]'::jsonb);
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('amd-epyc-9654',8,471200,now()-interval '14 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('amd-epyc-9654',9,471300,now()-interval '13 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('amd-epyc-9654',10,471400,now()-interval '12 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('amd-epyc-9654',7,471500,now()-interval '11 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('amd-epyc-9654',8,471600,now()-interval '10 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('amd-epyc-9654',9,471700,now()-interval '9 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('amd-epyc-9654',10,471800,now()-interval '8 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('amd-epyc-9654',7,471900,now()-interval '7 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('amd-epyc-9654',8,472000,now()-interval '6 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('amd-epyc-9654',9,472100,now()-interval '5 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('amd-epyc-9654',10,472200,now()-interval '4 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('amd-epyc-9654',7,472300,now()-interval '3 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('amd-epyc-9654',8,472400,now()-interval '2 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('amd-epyc-9654',9,472500,now()-interval '1 minutes');
INSERT INTO auctions (slug,title,category,description,condition,location,starting_price_cents,seller_id,closes_at,created_at,kicker,specs) VALUES ('one-point-five-tb-ddr5-ecc','1.5TB DDR5 ECC memory kit','Memory','A matched set of twenty-four 64GB DDR5 ECC RDIMMs. Every module passed a 72-hour memory test, which is more rest than any of us got this week.','Used · Matched set','Ashburn, VA',685900,3,now()+interval '38 minutes',now()-interval '4 days','Enough RAM to finally open Chrome','[["Capacity", "24 \u00d7 64GB"], ["Speed", "DDR5-4800"], ["Type", "ECC RDIMM"], ["Test result", "0 errors / 72 hours"]]'::jsonb);
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('one-point-five-tb-ddr5-ecc',8,686000,now()-interval '31 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('one-point-five-tb-ddr5-ecc',9,686100,now()-interval '30 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('one-point-five-tb-ddr5-ecc',10,686200,now()-interval '29 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('one-point-five-tb-ddr5-ecc',7,686300,now()-interval '28 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('one-point-five-tb-ddr5-ecc',8,686400,now()-interval '27 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('one-point-five-tb-ddr5-ecc',9,686500,now()-interval '26 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('one-point-five-tb-ddr5-ecc',10,686600,now()-interval '25 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('one-point-five-tb-ddr5-ecc',7,686700,now()-interval '24 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('one-point-five-tb-ddr5-ecc',8,686800,now()-interval '23 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('one-point-five-tb-ddr5-ecc',9,686900,now()-interval '22 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('one-point-five-tb-ddr5-ecc',10,687000,now()-interval '21 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('one-point-five-tb-ddr5-ecc',7,687100,now()-interval '20 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('one-point-five-tb-ddr5-ecc',8,687200,now()-interval '19 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('one-point-five-tb-ddr5-ecc',9,687300,now()-interval '18 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('one-point-five-tb-ddr5-ecc',10,687400,now()-interval '17 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('one-point-five-tb-ddr5-ecc',7,687500,now()-interval '16 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('one-point-five-tb-ddr5-ecc',8,687600,now()-interval '15 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('one-point-five-tb-ddr5-ecc',9,687700,now()-interval '14 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('one-point-five-tb-ddr5-ecc',10,687800,now()-interval '13 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('one-point-five-tb-ddr5-ecc',7,687900,now()-interval '12 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('one-point-five-tb-ddr5-ecc',8,688000,now()-interval '11 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('one-point-five-tb-ddr5-ecc',9,688100,now()-interval '10 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('one-point-five-tb-ddr5-ecc',10,688200,now()-interval '9 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('one-point-five-tb-ddr5-ecc',7,688300,now()-interval '8 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('one-point-five-tb-ddr5-ecc',8,688400,now()-interval '7 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('one-point-five-tb-ddr5-ecc',9,688500,now()-interval '6 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('one-point-five-tb-ddr5-ecc',10,688600,now()-interval '5 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('one-point-five-tb-ddr5-ecc',7,688700,now()-interval '4 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('one-point-five-tb-ddr5-ecc',8,688800,now()-interval '3 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('one-point-five-tb-ddr5-ecc',9,688900,now()-interval '2 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('one-point-five-tb-ddr5-ecc',10,689000,now()-interval '1 minutes');
INSERT INTO auctions (slug,title,category,description,condition,location,starting_price_cents,seller_id,closes_at,created_at,kicker,specs) VALUES ('supermicro-4u-gpu-chassis','Supermicro 4U GPU chassis','Chassis','A dense 4U platform for up to eight double-width accelerators. Fans are loud, airflow is excellent, and the bezel has only the tasteful amount of data-center patina.','Used · Minor rack wear','Chicago, IL',211100,4,now()+interval '1620 minutes',now()-interval '3 days','Rack mount, emotionally available','[["GPU capacity", "8 \u00d7 double-width"], ["Power", "4 \u00d7 2,000W"], ["Drive bays", "24 \u00d7 2.5-inch"], ["Rails", "Included"]]'::jsonb);
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('supermicro-4u-gpu-chassis',8,211200,now()-interval '9 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('supermicro-4u-gpu-chassis',9,211300,now()-interval '8 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('supermicro-4u-gpu-chassis',10,211400,now()-interval '7 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('supermicro-4u-gpu-chassis',7,211500,now()-interval '6 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('supermicro-4u-gpu-chassis',8,211600,now()-interval '5 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('supermicro-4u-gpu-chassis',9,211700,now()-interval '4 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('supermicro-4u-gpu-chassis',10,211800,now()-interval '3 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('supermicro-4u-gpu-chassis',7,211900,now()-interval '2 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('supermicro-4u-gpu-chassis',8,212000,now()-interval '1 minutes');
INSERT INTO auctions (slug,title,category,description,condition,location,starting_price_cents,seller_id,closes_at,created_at,kicker,specs) VALUES ('quantum-2-400g-switch','NVIDIA Quantum-2 400Gb switch','Networking','A 64-port NDR InfiniBand switch for clusters that have places to be. Firmware is current, ports are verified, and both redundant power supplies are included.','Certified refurbished','Dallas, TX',1273200,5,now()+interval '426 minutes',now()-interval '2 days','Latency has left the chat','[["Ports", "64 \u00d7 NDR 400Gb/s"], ["Throughput", "51.2Tb/s"], ["Form factor", "1U"], ["Airflow", "Port-to-power"]]'::jsonb);
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('quantum-2-400g-switch',8,1273300,now()-interval '18 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('quantum-2-400g-switch',9,1273400,now()-interval '17 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('quantum-2-400g-switch',10,1273500,now()-interval '16 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('quantum-2-400g-switch',7,1273600,now()-interval '15 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('quantum-2-400g-switch',8,1273700,now()-interval '14 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('quantum-2-400g-switch',9,1273800,now()-interval '13 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('quantum-2-400g-switch',10,1273900,now()-interval '12 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('quantum-2-400g-switch',7,1274000,now()-interval '11 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('quantum-2-400g-switch',8,1274100,now()-interval '10 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('quantum-2-400g-switch',9,1274200,now()-interval '9 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('quantum-2-400g-switch',10,1274300,now()-interval '8 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('quantum-2-400g-switch',7,1274400,now()-interval '7 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('quantum-2-400g-switch',8,1274500,now()-interval '6 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('quantum-2-400g-switch',9,1274600,now()-interval '5 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('quantum-2-400g-switch',10,1274700,now()-interval '4 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('quantum-2-400g-switch',7,1274800,now()-interval '3 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('quantum-2-400g-switch',8,1274900,now()-interval '2 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('quantum-2-400g-switch',9,1275000,now()-interval '1 minutes');
INSERT INTO auctions (slug,title,category,description,condition,location,starting_price_cents,seller_id,closes_at,created_at,kicker,specs) VALUES ('direct-to-chip-cooling-loop','Direct-to-chip cooling loop','Cooling','A sealed dual-block liquid cooling assembly sized for a 2U compute sled. Pressure-tested, leak-free, and considerably less alarming than the prototype looked.','New old stock','Austin, TX',97300,6,now()+interval '3540 minutes',now()-interval '1 days','Please don''t spill it','[["Cold plates", "2 \u00d7 nickel-plated copper"], ["Tubing", "EPDM, quick disconnect"], ["Rated load", "1,200W"], ["Coolant", "Not included"]]'::jsonb);
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('direct-to-chip-cooling-loop',8,97400,now()-interval '7 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('direct-to-chip-cooling-loop',9,97500,now()-interval '6 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('direct-to-chip-cooling-loop',10,97600,now()-interval '5 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('direct-to-chip-cooling-loop',7,97700,now()-interval '4 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('direct-to-chip-cooling-loop',8,97800,now()-interval '3 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('direct-to-chip-cooling-loop',9,97900,now()-interval '2 minutes');
INSERT INTO bids (auction_slug,bidder_id,amount_cents,created_at) VALUES ('direct-to-chip-cooling-loop',10,98000,now()-interval '1 minutes');
