"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getSession, signIn } from "next-auth/react";
import { homeFor } from "@/lib/roles";

/**
 * useSearchParams needs a Suspense boundary above it, so the form is a
 * separate component and the exported page wraps it.
 */
function LoginForm() {
  // Where to go after signing in. /bill/[id] sends people here when they
  // scan a QR code without a session, and they should land back on the
  // bill rather than on their own desk.
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await signIn("credentials", {
      redirect: false,
      username,
      password,
      callbackUrl: "/",
    });

    if (res?.error) {
      // NextAuth reports every failure the same way. Do not guess at the
      // cause -- a wrong password and an unreachable LDAP server look
      // identical from here.
      setError(
        res.error === "CredentialsSignin"
          ? "That username and password were not accepted."
          : res.error
      );
      setLoading(false);
      return;
    }

    if (res?.ok) {
      try {
        const session = await getSession();
        if (!session?.user?.id) {
          setError("Signed in, but the session could not be read. Please try again.");
          setLoading(false);
          return;
        }

        // The role comes from the database, resolved during sign-in.
        // homeFor understands the older spellings that are still in the
        // data, so nobody lands on a route that does not exist.
        // Only follow a same-origin path, so the parameter cannot be used
        // to bounce somebody to another site after they sign in.
        const safe =
          callbackUrl && callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")
            ? callbackUrl
            : null;

        window.location.href = safe ?? homeFor(session.user.employee_type);
        return;
      } catch {
        setError(
          "Signed in, but could not work out where to send you. " +
            "If you are off campus, connect to the IIT Mandi network and try again."
        );
      }
    }

    setLoading(false);
  };

   return (
    <div className="min-h-screen flex items-center justify-center bg-[#217093] p-4 sm:p-6">
      <div className="bg-white rounded-lg shadow-lg p-6 sm:p-8 w-full max-w-md mx-auto">
        <div className="flex flex-col items-center space-y-4 mb-6 sm:mb-8">
          <img 
            src="/iit.png" 
            alt="IIT Mandi" 
            className="h-16 w-16 sm:h-20 sm:w-20" 
          />
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-800">
            Log In
          </h2>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-1">
              LDAP Username
            </label>
            <input
              id="username"
              type="text"
              placeholder="Enter your username"
              className="w-full px-4 py-2 sm:py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
              LDAP Password
            </label>
            <input
              id="password"
              type="password"
              placeholder="Enter your password"
              className="w-full px-4 py-2 sm:py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <div className="p-3 text-sm text-red-700 bg-red-50 rounded-lg">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg text-sm sm:text-base transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-70"
          >
            {loading ? (
              <span className="flex items-center justify-center">
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Logging in...
              </span>
            ) : (
              "Log In"
            )}
          </button>

          <p className="text-center text-xs sm:text-sm text-gray-500 mt-6">
            Integrated Finance Management Portal - IIT Mandi
          </p>
        </form>
      </div>
    </div>
  );
} //


// "use client";

// import { useState } from "react";
// import { signIn } from "next-auth/react";
// import { useRouter } from "next/navigation";

// export default function LoginPage() {
//   const [username, setUsername] = useState("");
//   const [password, setPassword] = useState("");
//   const [error, setError] = useState<string | null>(null);
//   const [loading, setLoading] = useState(false);
//   const router = useRouter();

//   const handleSubmit = async (e: React.FormEvent) => {
//     e.preventDefault();
//     setLoading(true);
//     setError(null);

//     try {
//       const result = await signIn("credentials", {
//         redirect: false,
//         username,
//         password,
//       });

//       if (result?.error) {
//         setError("Invalid credentials. Please try again.");
//       } else {
//         router.push("/dashboard");
//       }
//     } catch (error) {
//       setError("An error occurred. Please try again.");
//     } finally {
//       setLoading(false);
//     }
//   };

//   return (
//     <div className="min-h-screen flex items-center justify-center bg-[#217093] p-4 sm:p-6">
//       <div className="bg-white rounded-lg shadow-lg p-6 sm:p-8 w-full max-w-md mx-auto">
//         <div className="flex flex-col items-center space-y-4 mb-6 sm:mb-8">
//           <img 
//             src="/iit.png" 
//             alt="IIT Mandi" 
//             className="h-16 w-16 sm:h-20 sm:w-20" 
//           />
//           <h2 className="text-2xl sm:text-3xl font-bold text-gray-800">
//             Log In
//           </h2>
//         </div>
        
//         <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
//           <div>
//             <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-1">
//               LDAP Username
//             </label>
//             <input
//               id="username"
//               type="text"
//               placeholder="Enter your username"
//               className="w-full px-4 py-2 sm:py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
//               value={username}
//               onChange={e => setUsername(e.target.value)}
//               required
//             />
//           </div>

//           <div>
//             <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
//               LDAP Password
//             </label>
//             <input
//               id="password"
//               type="password"
//               placeholder="Enter your password"
//               className="w-full px-4 py-2 sm:py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm sm:text-base"
//               value={password}
//               onChange={e => setPassword(e.target.value)}
//               required
//             />
//           </div>

//           {error && (
//             <div className="p-3 text-sm text-red-700 bg-red-50 rounded-lg">
//               {error}
//             </div>
//           )}

//           <button
//             type="submit"
//             disabled={loading}
//             className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg text-sm sm:text-base transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-70"
//           >
//             {loading ? (
//               <span className="flex items-center justify-center">
//                 <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
//                   <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
//                   <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
//                 </svg>
//                 Logging in...
//               </span>
//             ) : (
//               "Log In"
//             )}
//           </button>

//           <p className="text-center text-xs sm:text-sm text-gray-500 mt-6">
//             Integrated Finance Management Portal - IIT Mandi
//           </p>
//         </form>
//       </div>
//     </div>
//   );
// } // This closing brace was missing

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#217093]">
          <p className="text-white/80 text-sm">Loading…</p>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
