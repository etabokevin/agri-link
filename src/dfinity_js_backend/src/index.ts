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
  Consumer: text,
  Seller: text,
});

// Define the User struct to represent users of the platform
const User = Record({
  id: text,
  owner: Principal,
  name: text,
  email: text,
  role: UserRole,
  joinedAt: text,
});

// Category Enum(Consider it is farm produce)
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
  price: text,
  stock: text, // Number of items available in stock
  rating: text, // Average rating
  reviews: Vec(text), // Product reviews
  status: text, // e.g., 'available', 'out of stock'
  escrowBalance: text,
  disputeStatus: text,
  buyerAddress: Opt(text),
});

// Define the CartItem struct to represent items in the cart
const CartItem = Record({
  productId: text,
  quantity: text,
  price: text, // Price at the time of adding to the cart
});

// Define the Order struct to represent a user's order
const Order = Record({
  id: text,
  buyerId: text,
  products: Vec(CartItem),
  totalAmount: text,
  status: text, // e.g., 'pending', 'paid', 'shipped', 'delivered'
  createdAt: text,
});

// Define the Review struct to represent reviews for products
const Review = Record({
  productId: text,
  userId: text,
  rating: text,
  comment: text,
  createdAt: text,
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
})

// Product Payload
const ProductPayload = Record({
  name: text,
  description: text,
  category: Category,
  price: text,
  stock: text,
});

// Review Payload
const ReviewPayload = Record({
  productId: text,
  rating: text,
  comment: text,
});

// Storage initialization
const usersStorage = StableBTreeMap(0, text, User);
const productsStorage = StableBTreeMap(1, text, Product);
const ordersStorage = StableBTreeMap(2, text, Order);
const reviewsStorage = StableBTreeMap(3, text, Review);

// Canister Declaration
export default Canister({
  // Register a User (Consumer or Seller)
  registerUser: update([UserPayload], Result(User, Message), (payload) => {
    // Ensure required fields are provided
    if (!payload.name || !payload.email || !payload.role) {
      return Err({
        InvalidPayload: "Ensure 'name', 'email', and 'role' are provided.",
      });
    }

    // Check for valid email using regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(payload.email)) {
      return Err({ InvalidPayload: "Invalid email address" });
    }

    // Check if user already exists by making sure the email is unique
    const users = usersStorage.values();
    const userExists = users.some((user) => user.email === payload.email);

    if (userExists) {
      return Err({ Error: "User with this email already exists" });
    }

    // Create a new user
    const userId = uuidv4();
    const user = {
      id: userId,
      owner: ic.caller(),
      ...payload,
      joinedAt: new Date().toISOString(),
    };

    usersStorage.insert(userId, user);
    return Ok(user);
  }),

  // Add a Product (Seller only)
  addProduct: update([ProductPayload], Result(Product, Message), (payload) => {
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
    const product = {
      id: productId,
      sellerId,
      ...payload,
      rating: "0",
      reviews: [],
      status: BigInt(payload.stock) > 0n ? "available" : "out of stock",
      escrowBalance: "0",
      disputeStatus: "false",
      buyerAddress: None,
    };

    productsStorage.insert(productId, product);
    return Ok(product);
  }),

  // Add a Review for a Product (Consumer only)
  addReview: update([ReviewPayload], Result(Review, Message), (payload) => {
    if (!payload.productId || !payload.rating || !payload.comment) {
      return Err({
        InvalidPayload:
          "Ensure 'productId', 'rating', and 'comment' are provided.",
      });
    }

    const productOpt = productsStorage.get(payload.productId);
    if ("None" in productOpt) {
      return Err({ NotFound: "Product not found" });
    }

    const userId = ic.caller().toText();
    const reviewId = uuidv4();
    const review = {
      productId: payload.productId,
      userId,
      rating: payload.rating,
      comment: payload.comment,
      createdAt: new Date().toISOString(),
    };

    reviewsStorage.insert(reviewId, review);
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
    // Ensure cart is not empty
    if (cartItems.length === 0) {
      return Err({ InvalidPayload: "Cart is empty" });
    }

    let totalAmount = BigInt(0);
    const buyerId = ic.caller().toText();
    const productsInOrder: any[] = [];

    // Check if products in cart are available and have sufficient stock
    for (const item of cartItems) {
      const productOpt = productsStorage.get(item.productId);
      if ("None" in productOpt) {
        return Err({ NotFound: `Product not found: ${item.productId}` });
      }

      const product = productOpt.Some;
      if (BigInt(product.stock) < BigInt(item.quantity)) {
        return Err({
          Error: `Insufficient stock for product: ${product.name}`,
        });
      }

      totalAmount += BigInt(product.price) * BigInt(item.quantity);
      productsInOrder.push({
        productId: item.productId,
        quantity: item.quantity,
        price: product.price,
      });
    }

    const orderId = uuidv4();
    const order = {
      id: orderId,
      buyerId,
      products: productsInOrder,
      totalAmount: totalAmount.toString(),
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    ordersStorage.insert(orderId, order);
    return Ok(order);
  }),

  // View Orders (Consumer or Seller)
  viewOrders: query([], Result(Vec(Order), Message), () => {
    const userId = ic.caller().toText();
    const orders = ordersStorage
      .values()
      .filter((order) => order.buyerId === userId || order.sellerId === userId);

    if (orders.length === 0) {
      return Err({ NotFound: "No orders found" });
    }

    return Ok(orders);
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
