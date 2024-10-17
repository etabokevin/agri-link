import {
  query,
  update,
  text,
  Null,
  Record,
  StableBTreeMap,
  Variant,
  Vec,
  None,
  Some,
  Ok,
  Err,
  ic,
  Principal,
  Opt,
  Result,
  nat64,
  bool,
  Canister,
} from "azle";
import { v4 as uuidv4 } from "uuid";

// User Role Struct
const UserRole = Variant({
  Consumer: Null,
  Seller: Null,
});

// Define the User struct to represent users of the platform
const User = Record({
  id: text,
  owner: Principal,
  name: text,
  email: text,
  role: UserRole,
  joinedAt: nat64,
});

// Category Enum (Consider it is farm produce)
const Category = Variant({
  Vegetables: Null,
  Fruits: Null,
  Grains: Null,
  Poultry: Null,
  Other: Null,
});

// Define the Product struct to represent products available for purchase
const Product = Record({
  id: text,
  sellerId: text,
  name: text,
  description: text,
  category: Category,
  price: nat64,
  stock: nat64,
  rating: nat64,
  reviews: Vec(text),
  status: text,
  escrowBalance: nat64,
  disputeStatus: bool,
  buyerAddress: Opt(text),
});

// Define the CartItem struct to represent items in the cart
const CartItem = Record({
  productId: text,
  quantity: nat64,
  price: nat64,
});

// Define the Order struct to represent a user's order
const Order = Record({
  id: text,
  buyerId: text,
  products: Vec(CartItem),
  totalAmount: nat64,
  status: text,
  createdAt: nat64,
});

// Define the Review struct to represent reviews for products
const Review = Record({
  productId: text,
  userId: text,
  rating: nat64,
  comment: text,
  createdAt: nat64,
});

// Message to represent error or success messages
const Message = Variant({
  Success: text,
  Error: text,
  NotFound: text,
  InvalidPayload: text,
});

// User Payload
const UserPayload = Record({
  name: text,
  email: text,
  role: UserRole,
});

// Product Payload
const ProductPayload = Record({
  name: text,
  description: text,
  category: Category,
  price: nat64,
  stock: nat64,
});

// Review Payload
const ReviewPayload = Record({
  productId: text,
  rating: nat64,
  comment: text,
});

// Storage initialization
const usersStorage = StableBTreeMap(0, text, User);
const productsStorage = StableBTreeMap(1, text, Product);
const ordersStorage = StableBTreeMap(2, text, Order);
const reviewsStorage = StableBTreeMap(3, text, Review);

// Helper function to validate email
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Helper function to get user by principal
function getUserByPrincipal(principal: Principal): Result<User, Message> {
  const users = usersStorage.values();
  const user = users.find((u) => u.owner.toString() === principal.toString());
  if (!user) {
    return Err({ NotFound: "User not found" });
  }
  return Ok(user);
}

// Helper function to check if user is a seller
function isUserSeller(principal: Principal): Result<boolean, Message> {
  const userResult = getUserByPrincipal(principal);
  if ("Err" in userResult) {
    return userResult;
  }
  const user = userResult.Ok;
  return Ok("Seller" in user.role);
}

export default Canister({
  // Register a User (Consumer or Seller)
  registerUser: update([UserPayload], Result(User, Message), (payload) => {
    if (!payload.name || !payload.email || !payload.role) {
      return Err({
        InvalidPayload: "Ensure 'name', 'email', and 'role' are provided.",
      });
    }

    if (!isValidEmail(payload.email)) {
      return Err({ InvalidPayload: "Invalid email address" });
    }

    const users = usersStorage.values();
    const userExists = users.some((user) => user.email === payload.email);

    if (userExists) {
      return Err({ Error: "User with this email already exists" });
    }

    const userId = uuidv4();
    const user: User = {
      id: userId,
      owner: ic.caller(),
      ...payload,
      joinedAt: ic.time(),
    };

    usersStorage.insert(userId, user);
    return Ok(user);
  }),

  // Add a Product (Seller only)
  addProduct: update([ProductPayload], Result(Product, Message), (payload) => {
    const sellerResult = isUserSeller(ic.caller());
    if ("Err" in sellerResult) {
      return sellerResult;
    }
    if (!sellerResult.Ok) {
      return Err({ Error: "Only sellers can add products" });
    }

    if (
      !payload.name ||
      !payload.description ||
      !payload.price ||
      !payload.stock ||
      !payload.category
    ) {
      return Err({
        InvalidPayload:
          "Ensure 'name', 'description', 'category', 'price', and 'stock' are provided.",
      });
    }

    const sellerId = ic.caller().toText();
    const productId = uuidv4();
    const product: Product = {
      id: productId,
      sellerId,
      ...payload,
      rating: BigInt(0),
      reviews: [],
      status: payload.stock > 0n ? "available" : "out of stock",
      escrowBalance: BigInt(0),
      disputeStatus: false,
      buyerAddress: None,
    };

    productsStorage.insert(productId, product);
    return Ok(product);
  }),

  // Add a Review for a Product (Consumer only)
  addReview: update([ReviewPayload], Result(Review, Message), (payload) => {
    const userResult = getUserByPrincipal(ic.caller());
    if ("Err" in userResult) {
      return userResult;
    }
    const user = userResult.Ok;
    if ("Seller" in user.role) {
      return Err({ Error: "Only consumers can add reviews" });
    }

    if (!payload.productId || !payload.rating || !payload.comment) {
      return Err({
        InvalidPayload:
          "Ensure 'productId', 'rating', and 'comment' are provided.",
      });
    }

    if (payload.rating < 1n || payload.rating > 5n) {
      return Err({ InvalidPayload: "Rating must be between 1 and 5" });
    }

    const productOpt = productsStorage.get(payload.productId);
    if ("None" in productOpt) {
      return Err({ NotFound: "Product not found" });
    }

    const reviewId = uuidv4();
    const review: Review = {
      productId: payload.productId,
      userId: user.id,
      rating: payload.rating,
      comment: payload.comment,
      createdAt: ic.time(),
    };

    reviewsStorage.insert(reviewId, review);

    // Update product rating
    const product = productOpt.Some;
    const reviews = reviewsStorage.values().filter((r) => r.productId === product.id);
    const totalRating = reviews.reduce((sum, r) => sum + r.rating, BigInt(0));
    product.rating = totalRating / BigInt(reviews.length);
    productsStorage.insert(product.id, product);

    return Ok(review);
  }),

  // View Products
  viewProducts: query([], Result(Vec(Product), Message), () => {
    const products = productsStorage.values();
    if (products.length === 0) {
      return Err({ NotFound: "No products found" });
    }

    return Ok(products);
  }),

  // View Reviews for a Product
  viewProductReviews: query([text], Result(Vec(Review), Message), (productId) => {
    const reviews = reviewsStorage
      .values()
      .filter((review) => review.productId === productId);
    if (reviews.length === 0) {
      return Err({ NotFound: "No reviews found for this product" });
    }

    return Ok(reviews);
  }),

  // Checkout and Create an Order (Consumer only)
  checkout: update([Vec(CartItem)], Result(Order, Message), (cartItems) => {
    const userResult = getUserByPrincipal(ic.caller());
    if ("Err" in userResult) {
      return userResult;
    }
    const user = userResult.Ok;
    if ("Seller" in user.role) {
      return Err({ Error: "Only consumers can create orders" });
    }

    if (cartItems.length === 0) {
      return Err({ InvalidPayload: "Cart is empty" });
    }

    let totalAmount = BigInt(0);
    const productsInOrder: CartItem[] = [];

    for (const item of cartItems) {
      const productOpt = productsStorage.get(item.productId);
      if ("None" in productOpt) {
        return Err({ NotFound: `Product not found: ${item.productId}` });
      }

      const product = productOpt.Some;
      if (product.stock < item.quantity) {
        return Err({
          Error: `Insufficient stock for product: ${product.name}`,
        });
      }

      totalAmount += product.price * item.quantity;
      productsInOrder.push({
        productId: item.productId,
        quantity: item.quantity,
        price: product.price,
      });

      // Update product stock
      product.stock -= item.quantity;
      productsStorage.insert(product.id, product);
    }

    const orderId = uuidv4();
    const order: Order = {
      id: orderId,
      buyerId: user.id,
      products: productsInOrder,
      totalAmount,
      status: "pending",
      createdAt: ic.time(),
    };

    ordersStorage.insert(orderId, order);
    return Ok(order);
  }),

  // View Orders (Consumer or Seller)
  viewOrders: query([], Result(Vec(Order), Message), () => {
    const userResult = getUserByPrincipal(ic.caller());
    if ("Err" in userResult) {
      return userResult;
    }
    const user = userResult.Ok;

    let orders: Order[];
    if ("Consumer" in user.role) {
      orders = ordersStorage.values().filter((order) => order.buyerId === user.id);
    } else {
      const sellerProducts = productsStorage.values().filter((p) => p.sellerId === user.id);
      const sellerProductIds = new Set(sellerProducts.map((p) => p.id));
      orders = ordersStorage.values().filter((order) =>
        order.products.some((item) => sellerProductIds.has(item.productId))
      );
    }

    if (orders.length === 0) {
      return Err({ NotFound: "No orders found" });
    }

    return Ok(orders);
  }),

  // Search Products by Category
  searchProductsByCategory: query([Category], Result(Vec(Product), Message), (category) => {
    const products = productsStorage.values().filter((p) => p.category === category);
    if (products.length === 0) {
      return Err({ NotFound: "No products found in this category" });
    }
    return Ok(products);
  }),

  // Get User Profile
  getUserProfile: query([], Result(User, Message), () => {
    return getUserByPrincipal(ic.caller());
  }),

  // Update User Profile
  updateUserProfile: update([UserPayload], Result(User, Message), (payload) => {
    const userResult = getUserByPrincipal(ic.caller());
    if ("Err" in userResult) {
      return userResult;
    }
    const user = userResult.Ok;

    if (payload.email && !isValidEmail(payload.email)) {
      return Err({ InvalidPayload: "Invalid email address" });
    }

    const updatedUser: User = {
      ...user,
      name: payload.name || user.name,
      email: payload.email || user.email,
      role: payload.role || user.role,
    };

    usersStorage.insert(user.id, updatedUser);
    return Ok(updatedUser);
  }),

  // Get Product Details
  getProductDetails: query([text], Result(Product, Message), (productId) => {
    const productOpt = productsStorage.get(productId);
    if ("None" in productOpt) {
      return Err({ NotFound: "Product not found" });
    }
    return Ok(productOpt.Some);
  }),

  // Escrow Management
  add_to_escrow: update([text, text], Result(Message, Message), (productId, amount) => {
    const productOpt = productsStorage.get(productId);
    if ("None" in productOpt) {
      return Err({ NotFound: "Product not found" });
    }

    const product = productOpt.Some;
    product.escrowBalance = BigInt(product.escrowBalance) + BigInt(amount);
    productsStorage.insert(productId, product);

    return Ok({ Success: "Escrow balance updated." });
  }),

  release_payment: update([text], Result(Message, Message), (productId) => {
    const productOpt = productsStorage.get(productId);
    if ("None" in productOpt) {
      return Err({ NotFound: "Product not found" });
    }

    const product = productOpt.Some;
    if (product.status !== "sold") {
      return Err({ Error: "Product has not been sold yet." });
    }

    if (product.disputeStatus === true) {
      return Err({ Error: "Dispute unresolved, cannot release payment." });
    }

    product.escrowBalance = "0";
    productsStorage.insert(productId, product);

    return Ok({ Success: "Payment released." });
  }),

  withdraw_from_escrow: update([text, text], Result(Message, Message), (productId, amount) => {
    const productOpt = productsStorage.get(productId);
    if ("None" in productOpt) {
      return Err({ NotFound: "Product not found" });
    }

    const product = productOpt.Some;
    if (BigInt(product.escrowBalance) < BigInt(amount)) {
      return Err({ Error: "Insufficient escrow balance." });
    }

    product.escrowBalance = BigInt(product.escrowBalance) - BigInt(amount);
    productsStorage.insert(productId, product);

    return Ok({ Success: "Amount withdrawn from escrow." });
  }),

  // Dispute Management
  dispute_product: update([text], Result(Message, Message), (productId) => {
    const productOpt = productsStorage.get(productId);
    if ("None" in productOpt) {
      return Err({ NotFound: "Product not found" });
    }

    const product = productOpt.Some;
    product.disputeStatus = true;
    product.status = "dispute raised";
    productsStorage.insert(productId, product);

    return Ok({ Success: "Dispute raised successfully." });
  }),

  resolve_dispute: update([text, bool], Result(Message, Message), (productId, resolution) => {
    const productOpt = productsStorage.get(productId);
    if ("None" in productOpt) {
      return Err({ NotFound: "Product not found" });
    }

    const product = productOpt.Some;
    if (!product.disputeStatus) {
      return Err({ Error: "No dispute to resolve." });
    }

    product.disputeStatus = false;
    product.status = resolution
        ? "dispute resolved - funds to seller"
        : "dispute resolved - funds to buyer";
    productsStorage.insert(productId, product);

    return Ok({ Success: "Dispute resolved." });
  }),

  // Mark Product as Sold
  mark_product_sold: update([text], Result(Message, Message), (productId) => {
    const productOpt = productsStorage.get(productId);
    if ("None" in productOpt) {
      return Err({ NotFound: "Product not found" });
    }

    const product = productOpt.Some;
    if (product.status !== "Bid Accepted") {
      return Err({ Error: "Bid not accepted or product already sold." });
    }

    product.status = "sold";
    productsStorage.insert(productId, product);

    return Ok({ Success: "Product marked as sold." });
  }),

  // Bidding and Acceptance of Bid
  product_bid: update([text, text], Result(Message, Message), (productId, buyerAddress) => {
    const productOpt = productsStorage.get(productId);
    if ("None" in productOpt) {
      return Err({ NotFound: "Product not found" });
    }

    const product = productOpt.Some;
    if (product.buyerAddress) {
      return Err({ Error: "Product has already been bid on." });
    }

    product.buyerAddress = buyerAddress;
    product.status = "Bid Placed";
    productsStorage.insert(productId, product);

    return Ok({ Success: "Bid placed successfully." });
  }),

  accept_bid: update([text], Result(Message, Message), (productId) => {
    const productOpt = productsStorage.get(productId);
    if ("None" in productOpt) {
      return Err({ NotFound: "Product not found" });
    }

    const product = productOpt.Some;
    if (!product.buyerAddress) {
      return Err({ Error: "No bid to accept." });
    }

    product.status = "Bid Accepted";
    productsStorage.insert(productId, product);

    return Ok({ Success: "Bid accepted successfully." });
  }),

  // Rating System
  rate_product: update([text, text], Result(Message, Message), (productId, rating) => {
    const productOpt = productsStorage.get(productId);
    if ("None" in productOpt) {
      return Err({ NotFound: "Product not found" });
    }

    const product = productOpt.Some;
    product.rating = rating;
    productsStorage.insert(productId, product);

    return Ok({ Success: "Product rated successfully." });
  }),

  // Update Functions
  update_product_category: update([text, text], Result(Message, Message), (productId, category) => {
    const productOpt = productsStorage.get(productId);
    if ("None" in productOpt) {
      return Err({ NotFound: "Product not found" });
    }

    const product = productOpt.Some;
    product.category = category;
    productsStorage.insert(productId, product);

    return Ok({ Success: "Product category updated." });
  }),

  update_product_description: update([text, text], Result(Message, Message), (productId, description) => {
    const productOpt = productsStorage.get(productId);
    if ("None" in productOpt) {
      return Err({ NotFound: "Product not found" });
    }

    const product = productOpt.Some;
    product.description = description;
    productsStorage.insert(productId, product);

    return Ok({ Success: "Product description updated." });
  }),

  update_product_price: update([text, text], Result(Message, Message), (productId, price) => {
    const productOpt = productsStorage.get(productId);
    if ("None" in productOpt) {
      return Err({ NotFound: "Product not found" });
    }

    const product = productOpt.Some;
    product.price = price;
    productsStorage.insert(productId, product);
    return Ok({ Success: "Product price updated." });
  }),

  update_product_status: update([text, text], Result(Message, Message), (productId, status) => {
    const productOpt = productsStorage.get(productId);
    if ("None" in productOpt) {
      return Err({ NotFound: "Product not found" });
    }

    const product = productOpt.Some;
    product.status = status;
    productsStorage.insert(productId, product);

    return Ok({ Success: "Product status updated." });
  }),
});
