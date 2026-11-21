import { Routes, Route } from "react-router-dom";

// Components
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import EventSearch from "./components/EventSearch";
import FeaturedEvents from "./components/FeaturedEvents";
import CategorySection from "./components/CategorySection";
import WhyChooseUs from "./components/WhyChooseUs";
import Footer from "./components/Footer";


// Pages
import Events from "./pages/Events";
import EventDetails from "./pages/EventDetails";
import Checkout from "./pages/Checkout";

// Global styles
import "./App.css";

// Home Page
function Home() {
  return (
    <>
      <Hero />
      <EventSearch />
      <FeaturedEvents />
      <CategorySection />
      <WhyChooseUs />
    </>
  );
}

// About Page
function About() {
  return (
    <div className="page-content">
      <h1>About TikitiHub</h1>

      <p>
        TikitiHub makes discovering and booking events simple.
        Find experiences worth remembering.
      </p>
    </div>
  );
}

// Login Page
function Login() {
  return (
    <div className="page-content">
      <h1>Sign In to TikitiHub</h1>
    </div>
  );
}

// Registration Page
function Register() {
  return (
    <div className="page-content">
      <h1>Create Your Account</h1>
    </div>
  );
}

// Main Application
function App() {
  return (
    <>
      <Navbar />

<Routes>
  <Route path="/" element={<Home />} />
  <Route path="/events" element={<Events />} />
  <Route path="/events/:id" element={<EventDetails />} />
  <Route path="/checkout" element={<Checkout />} />
  <Route path="/about" element={<About />} />
  <Route path="/login" element={<Login />} />
  <Route path="/register" element={<Register />} />
</Routes>

      <Footer />
    </>
  );
}

export default App;