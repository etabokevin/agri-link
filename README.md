
# Decentralized Marketplace for Products

## Description
This decentralized marketplace allows farmers to register as consumers or sellers, add products for sale, manage product listings, and conduct transactions in a secure and transparent environment. The marketplace also features escrow management, dispute resolution, product bidding, and a product rating system to enhance trust and reliability among users.

The platform allows farmers to list products, manage bids, and handle payments securely within a decentralized framework, enhancing transparency and efficiency.


## Structs

### User
Represents users of the platform, either **Consumers** or **Sellers**.
```typescript
const User = Record({
    id: text,
    owner: Principal,
    name: text,
    email: text,
    role: UserRole, // Consumer or Seller
    joinedAt: text,
});
```

### Product
Represents products available for purchase in the marketplace.
```typescript
const Product = Record({
    id: text,
    sellerId: text,
    name: text,
    description: text,
    category: text,
    price: text,
    stock: text, // Number of items available in stock
    rating: text, // Average rating
    reviews: Vec(text), // Product reviews
    status: text, // e.g., 'available', 'out of stock'
    escrowBalance: text, // Balance in escrow
    disputeStatus: text, // 'true' if a dispute is raised
    buyerAddress: Opt(text), // Address of the buyer
});
```

### CartItem
Represents individual items in a user's cart during checkout.
```typescript
const CartItem = Record({
    productId: text,
    quantity: text,
    price: text, // Price at the time of adding to the cart
});
```

### Order
Represents a user's order in the marketplace.
```typescript
const Order = Record({
    id: text,
    buyerId: text,
    products: Vec(CartItem),
    totalAmount: text,
    status: text, // e.g., 'pending', 'paid', 'shipped', 'delivered'
    createdAt: text,
});
```

### Review
Represents a user's review of a product.
```typescript
const Review = Record({
    productId: text,
    userId: text,
    rating: text,
    comment: text,
    createdAt: text,
});
```

### Message
Represents responses in the system, for success, errors, and various statuses.
```typescript
const Message = Variant({
    Success: text,
    Error: text,
    NotFound: text,
    InvalidPayload: text,
});
```

## Sample Payloads

### User Registration Payload
To register a new user as either a **Consumer** or **Seller**:
```json
{
  "name": "John Doe",
  "email": "john.doe@example.com",
  "role": {
    "Consumer": "Buyer"
  }
}
```

### Add Product Payload
To add a new product as a **Seller**:
```json
{
  "name": "Organic Apples",
  "description": "Fresh organic apples from the farm.",
  "category": "Fruits",
  "price": "5.00",
  "stock": "100"
}
```

### Review Payload
To add a review for a product:
```json
{
  "productId": "12345-abcde",
  "rating": "5",
  "comment": "Excellent product, very fresh!"
}
```

### Escrow Management Payload
- **Add to Escrow**:
```json
{
  "productId": "12345-abcde",
  "amount": "50"
}
```

- **Withdraw from Escrow**:
```json
{
  "productId": "12345-abcde",
  "amount": "30"
}
```

### Dispute Management Payload
- **Raise a Dispute**:
```json
{
  "productId": "12345-abcde"
}
```

- **Resolve a Dispute**:
```json
{
  "productId": "12345-abcde",
  "resolution": true
}
```

### Bidding Payload
- **Place a Bid**:
```json
{
  "productId": "12345-abcde",
  "buyerAddress": "some-buyer-address"
}
```

### Rating Payload
To rate a product:
```json
{
  "productId": "12345-abcde",
  "rating": "4"
}
```



## Things to be explained in the course:
1. What is Ledger? More details here: https://internetcomputer.org/docs/current/developer-docs/integrations/ledger/
2. What is Internet Identity? More details here: https://internetcomputer.org/internet-identity
3. What is Principal, Identity, Address? https://internetcomputer.org/internet-identity | https://yumimarketplace.medium.com/whats-the-difference-between-principal-id-and-account-id-3c908afdc1f9
4. Canister-to-canister communication and how multi-canister development is done? https://medium.com/icp-league/explore-backend-multi-canister-development-on-ic-680064b06320

## How to deploy canisters implemented in the course

### Ledger canister
`./deploy-local-ledger.sh` - deploys a local Ledger canister. IC works differently when run locally so there is no default network token available and you have to deploy it yourself. Remember that it's not a token like ERC-20 in Ethereum, it's a native token for ICP, just deployed separately.
This canister is described in the `dfx.json`:
```
	"ledger_canister": {
  	"type": "custom",
  	"candid": "https://raw.githubusercontent.com/dfinity/ic/928caf66c35627efe407006230beee60ad38f090/rs/rosetta-api/icp_ledger/ledger.did",
  	"wasm": "https://download.dfinity.systems/ic/928caf66c35627efe407006230beee60ad38f090/canisters/ledger-canister.wasm.gz",
  	"remote": {
    	"id": {
      	"ic": "ryjl3-tyaaa-aaaaa-aaaba-cai"
    	}
  	}
	}
```
`remote.id.ic` - that is the principal of the Ledger canister and it will be available by this principal when you work with the ledger.

Also, in the scope of this script, a minter identity is created which can be used for minting tokens
for the testing purposes.
Additionally, the default identity is pre-populated with 1000_000_000_000 e8s which is equal to 10_000 * 10**8 ICP.
The decimals value for ICP is 10**8.

List identities:
`dfx identity list`

Switch to the minter identity:
`dfx identity use minter`

Transfer ICP:
`dfx ledger transfer <ADDRESS>  --memo 0 --icp 100 --fee 0`
where:
 - `--memo` is some correlation id that can be set to identify some particular transactions (we use that in the marketplace canister).
 - `--icp` is the transfer amount
 - `--fee` is the transaction fee. In this case it's 0 because we make this transfer as the minter idenity thus this transaction is of type MINT, not TRANSFER.
 - `<ADDRESS>` is the address of the recipient. To get the address from the principal, you can use the helper function from the marketplace canister - `getAddressFromPrincipal(principal: Principal)`, it can be called via the Candid UI.


### Internet identity canister

`dfx deploy internet_identity` - that is the canister that handles the authentication flow. Once it's deployed, the `js-agent` library will be talking to it to register identities. There is UI that acts as a wallet where you can select existing identities
or create a new one.

### Marketplace canister

`dfx deploy dfinity_js_backend` - deploys the marketplace canister where the business logic is implemented.
Basically, it implements functions like add, view, update, delete, and buy products + a set of helper functions.

Do not forget to run `dfx generate dfinity_js_backend` anytime you add/remove functions in the canister or when you change the signatures.
Otherwise, these changes won't be reflected in IDL's and won't work when called using the JS agent.

## Simple User Flow

1. **Register**: 
   A user registers as either a **Consumer** or a **Seller** by providing their name, email, and role.
   
2. **Seller Adds Product**:
   Once registered, a seller can add products for sale by providing the product's name, description, category, price, and stock.

3. **Consumers View Products**:
   Consumers can view a list of all available products. They can also view reviews for individual products.

4. **Bidding**:
   Consumers can place bids on products they wish to purchase. The seller can then accept or reject the bid.

5. **Checkout**:
   Once a bid is accepted, the consumer can proceed to checkout and create an order for the product.

6. **Escrow Management**:
   Upon a successful purchase, the system places funds in escrow until the product is delivered. Sellers can request payment release, and disputes can be raised if there are any issues.

7. **Dispute Management**:
   If there is a disagreement over the product, either the consumer or seller can raise a dispute. The system allows disputes to be resolved with funds allocated based on the resolution.

8. **Rating & Review**:
   After the transaction, consumers can leave reviews and rate the products, allowing other users to benefit from their feedback.

