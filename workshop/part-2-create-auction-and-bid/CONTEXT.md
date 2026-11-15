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
