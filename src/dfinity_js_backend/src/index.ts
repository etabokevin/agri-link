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
  price: nat64,
  stock: nat64,
  rating: text, // Average rating
  reviews: Vec(text), // Product reviews
  status: text, // e.g., 'available', 'out of stock'
  escrowBalance: nat64,
  disputeStatus: bool,
  buyerAddress: Opt(text),
});

// Define the CartItem struct to represent items in the cart
const CartItem = Record({
  productId: text,
  quantity: nat64,
  price: nat64, // Price at the time of adding to the cart
});

// Define the Order struct to represent a user's order
const Order = Record({
  id: text,
  buyerId: text,
  products: Vec(CartItem),
  totalAmount: nat64,
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
  rating: text,
  comment: text,
});

// Storage initialization
const usersStorage = StableBTreeMap(0, text, User);
const emailIndex = StableBTreeMap(1, text, text); // New index for email uniqueness
const productsStorage = StableBTreeMap(2, text, Product);
const ordersStorage = StableBTreeMap(3, text, Order);
const reviewsStorage = StableBTreeMap(4, text, Review);

// Helper function to get a product by ID
function getProductById(productId: text): Result<Product, Message> {
  const productOpt = productsStorage.get(productId);
  return productOpt ? Ok(productOpt.Some) : Err({ NotFound: "Product not found" });
}

// Helper function to validate user role
function validateUserRole(expectedRole: UserRole): Result<void, Message> {
  const caller = ic.caller().toText();
  const user = usersStorage.values().find((u) => u.owner.toText() === caller);
  if (!user) return Err({ Error: "User not registered" });
  if (user.role !== expectedRole) return Err({ Error: "Unauthorized role" });
  return Ok();
}

// Canister Declaration
export default Canister({
  // Register a User (Consumer or Seller)
  registerUser: update([UserPayload], Result(User, Message), (payload) => {
    if (!payload.name || !payload.email || !payload.role) {
      return Err({ InvalidPayload: "Ensure 'name', 'email', and 'role' are provided." });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(payload.email)) {
      return Err({ InvalidPayload: "Invalid email address" });
    }

    if (emailIndex.has(payload.email)) {
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
    emailIndex.insert(payload.email, userId); // Add to email index
    return Ok(user);
  }),

  // Add a Product (Seller only)
  addProduct: update([ProductPayload], Result(Product, Message), (payload) => {
    const auth = validateUserRole(UserRole.Seller);
    if ("Err" in auth) return auth;

    if (!payload.name || !payload.description || !payload.price || !payload.stock || !payload.category) {
      return Err({ InvalidPayload: "Ensure 'name', 'description', 'category', 'price', and 'stock' are provided." });
    }

    const sellerId = ic.caller().toText();
    const productId = uuidv4();
    const product = {
      id: productId,
      sellerId,
      ...payload,
      rating: "0",
      reviews: [],
      status: payload.stock > 0n ? "available" : "out of stock",
      escrowBalance: 0n,
      disputeStatus: false,
      buyerAddress: None,
    };

    productsStorage.insert(productId, product);
    return Ok(product);
  }),

  // Add a Review for a Product (Consumer only)
  addReview: update([ReviewPayload], Result(Review, Message), (payload) => {
    const auth = validateUserRole(UserRole.Consumer);
    if ("Err" in auth) return auth;

    const productResult = getProductById(payload.productId);
    if ("Err" in productResult) return productResult;

    if (!payload.rating || !payload.comment) {
      return Err({ InvalidPayload: "Ensure 'rating' and 'comment' are provided." });
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

  // Checkout and Create an Order (Consumer only)
  checkout: update([Vec(CartItem)], Result(Order, Message), (cartItems) => {
    const auth = validateUserRole(UserRole.Consumer);
    if ("Err" in auth) return auth;

    if (cartItems.length === 0) {
      return Err({ InvalidPayload: "Cart is empty" });
    }

    let totalAmount = 0n;
    const buyerId = ic.caller().toText();
    const productsInOrder: CartItem[] = [];

    for (const item of cartItems) {
      const productResult = getProductById(item.productId);
      if ("Err" in productResult) return productResult;

      const product = productResult.Ok;
      if (product.stock < item.quantity) {
        return Err({ Error: `Insufficient stock for product: ${product.name}` });
      }

      totalAmount += product.price * item.quantity;
      productsInOrder.push({ ...item, price: product.price });
    }

    const orderId = uuidv4();
    const order = {
      id: orderId,
      buyerId,
      products: productsInOrder,
      totalAmount,
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    ordersStorage.insert(orderId, order);
    return Ok(order);
  }),

  // Escrow Management
  add_to_escrow: update([text, nat64], Result(Message, Message), (productId, amount) => {
    const auth = validateUserRole(UserRole.Seller);
    if ("Err" in auth) return auth;

    const productResult = getProductById(productId);
    if ("Err" in productResult) return productResult;

    const product = productResult.Ok;
    if (product.sellerId !== ic.caller().toText()) {
      return Err({ Error: "Unauthorized to modify this product's escrow" });
    }

    product.escrowBalance += amount;
    productsStorage.insert(productId, product);

    return Ok({ Success: "Escrow balance updated." });
  }),
});
