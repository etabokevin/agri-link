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
  price: text,
  stock: text,
  rating: text,
  reviews: Vec(text),
  status: text,
  escrowBalance: text,
  disputeStatus: text,
  buyerAddress: Opt(text),
});

// Define the CartItem struct to represent items in the cart
const CartItem = Record({
  productId: text,
  quantity: text,
  price: text,
});

// Define the Order struct to represent a user's order
const Order = Record({
  id: text,
  buyerId: text,
  products: Vec(CartItem),
  totalAmount: text,
  status: text,
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
});

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

// Utility function for validating numeric input
function isValidPositiveInteger(value: string): boolean {
  try {
    const num = BigInt(value);
    return num > 0n;
  } catch {
    return false;
  }
}

// Canister Declaration
export default Canister({
  // Register a User (Consumer or Seller)
  registerUser: update([UserPayload], Result(User, Message), (payload) => {
    if (!payload.name || !payload.email || !payload.role) {
      return Err({
        InvalidPayload: "Ensure 'name', 'email', and 'role' are provided.",
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(payload.email)) {
      return Err({ InvalidPayload: "Invalid email address" });
    }

    const users = usersStorage.values();
    const userExists = users.some((user) => user.email === payload.email);

    if (userExists) {
      return Err({ Error: "User with this email already exists" });
    }

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
      !payload.category ||
      !isValidPositiveInteger(payload.price) ||
      !isValidPositiveInteger(payload.stock)
    ) {
      return Err({
        InvalidPayload:
          "Ensure 'name', 'description', 'category', 'price', and 'stock' are valid positive integers.",
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
    if (cartItems.length === 0) {
      return Err({ InvalidPayload: "Cart is empty" });
    }

    let totalAmount = BigInt(0);
    const buyerId = ic.caller().toText();
    const productsInOrder: any[] = [];

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
    if (ic.caller() !== Principal.fromText(product.sellerId)) {
      return Err({ Error: "Unauthorized to release payment." });
    }

    // Logic to release payment...
    // This is where the payment release logic would go.

    return Ok({ Success: "Payment released." });
  }),

  // Dispute Resolution
  resolve_dispute: update([text, bool], Result(Message, Message), (productId, decision) => {
    const productOpt = productsStorage.get(productId);
    if ("None" in productOpt) {
      return Err({ NotFound: "Product not found" });
    }

    const product = productOpt.Some;
    if (ic.caller() !== Principal.fromText(product.sellerId)) {
      return Err({ Error: "Unauthorized to resolve dispute." });
    }

    product.disputeStatus = decision ? "resolved" : "unresolved";
    productsStorage.insert(productId, product);

    return Ok({ Success: `Dispute ${decision ? "resolved" : "not resolved"}.` });
  }),
});
