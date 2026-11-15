# Defer concurrent-bid protection to Part 3

Part 2 persists auctions and bids in PostgreSQL and validates sequential bids against the current amount, but the user explicitly defers concurrent-bid protection to Part 3. Simultaneous requests are outside Part 2's correctness guarantee; the bidding implementation must not be described as concurrency-safe until that protection is added.
