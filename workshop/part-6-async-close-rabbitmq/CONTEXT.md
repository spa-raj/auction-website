# Auctions and Bids

An auction offers an item for bids until its closing time.

## Language

**Demo user**:
One of ten predefined participants who can act as a seller or bidder.
_Avoid_: Authenticated user, verified user

**Active user**:
The demo user currently assigned to a browser tab, initially at random and changeable through the user switcher.

**Auction**:
A published listing with a seller, item details, starting price, and closing time. It becomes visible immediately when posted.
_Avoid_: Product (when referring to the listing)

**Seller**:
The participant who posts an auction. A seller cannot bid on their own auction.

**Bid**:
An explicit offer made by a bidder on an auction, with an amount and a time. It does not authorize automatic bidding up to a maximum.

**Bidder**:
The participant who submits a bid.

**Starting price**:
The amount set by the seller when posting an auction.

**Current amount**:
The highest accepted bid amount, or the starting price when there are no bids.

**Minimum bid**:
An amount at least $1 above the current amount, including for the first bid.

**Closing time**:
The fixed instant at and after which an auction no longer accepts bids.

**Winner**:
The participant with the highest accepted bid when the auction ends. An auction with no bids has no winner.

**Bid history**:
The record of bids on an auction, showing each bidder, amount, and time.

**Stale bid**:
A submitted bid whose amount falls below the minimum required after another bid has been accepted. A bid from an older displayed price remains eligible if its amount still meets the minimum.

**Acceptance time**:
The instant at which a bid is checked against the closing time after earlier competing bids have been resolved. A bid checked at or after closing cannot be accepted.

**Auction watcher**:
A viewer currently looking at an auction's detail page, including its seller or a bidder.

**Auction change notification**:
A signal that an auction may have newer state. It is not proof that the viewer has the latest price or history.

**Final outcome**:
The permanent result recorded after an auction ends: its winning bidder and winning amount, or that it ended without bids. Recording the result does not extend the closing time.
_Avoid_: Payment confirmation, provisional winner

**Finalization time**:
The instant at which an auction’s final outcome is recorded, which may be later than its closing time.

**Outcome notification**:
A notice of the recorded final outcome addressed to the seller or winning bidder. It remains pending until that recipient explicitly dismisses it.

**Dismissal**:
A recipient’s explicit acknowledgement that an outcome notification can stop appearing in their windows. It does not alter the auction’s final outcome.
