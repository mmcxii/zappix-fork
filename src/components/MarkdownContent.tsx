import { Link, Skeleton, Tooltip } from "@mui/material"; // Added Skeleton, Tooltip
import { NDKSubscriptionCacheUsage, NDKUserProfile } from "@nostr-dev-kit/ndk"; // Import NDK types
import { nip19 } from "nostr-tools"; // Import nip19
import React, { useEffect, useState } from "react"; // Added hooks
import ReactMarkdown, { Components } from "react-markdown";
import { Link as RouterLink } from "react-router-dom"; // v6
import remarkGfm from "remark-gfm";
import { useNdk } from "../contexts/NdkContext"; // Import useNdk hook

interface MarkdownContentProps {
  content: string;
}

// --- Component to render NIP-19 mentions ---
interface NostrMentionProps {
  uri: string;
}

const NostrMention: React.FC<NostrMentionProps> = ({ uri }) => {
  const { ndk } = useNdk();
  const [, setProfile] = useState<null | NDKUserProfile>(null);
  const [displayName, setDisplayName] = useState<string>("");
  const [npub, setNpub] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isValidNostrUri, setIsValidNostrUri] = useState<boolean>(false);
  const [targetPath, setTargetPath] = useState<string>("#"); // Default/fallback path

  useEffect(() => {
    let decodedType = "";
    let decodedData: object | string = ""; // Can be string (pubkey/id) or object (nprofile/nevent)

    try {
      // Remove "nostr:" prefix if present
      const bareUri = uri.startsWith("nostr:") ? uri.substring(6) : uri;
      const decodedResult = nip19.decode(bareUri);
      decodedType = decodedResult.type;
      decodedData = decodedResult.data;
      setIsValidNostrUri(true);

      if (decodedType === "npub" && typeof decodedData === "string") {
        setNpub(bareUri); // Store original npub for link
        setTargetPath(`/profile/${bareUri}`);
        setDisplayName(bareUri.substring(0, 10) + "..."); // Default display
        setIsLoading(true);
        ndk
          ?.getUser({ pubkey: decodedData })
          .fetchProfile({ cacheUsage: NDKSubscriptionCacheUsage.CACHE_FIRST })
          .then((p) => {
            setProfile(p);
            setDisplayName(p?.displayName || p?.name || bareUri.substring(0, 10) + "...");
          })
          .catch((e) => console.error(`Failed to fetch profile for ${bareUri}`, e))
          .finally(() => setIsLoading(false));
      } else if (
        decodedType === "nprofile" &&
        typeof decodedData === "object" &&
        "pubkey" in decodedData
      ) {
        const nprofileData = decodedData as nip19.ProfilePointer;
        const profileNpub = nip19.npubEncode(nprofileData.pubkey);
        setNpub(profileNpub);
        setTargetPath(`/profile/${profileNpub}`);
        setDisplayName(profileNpub.substring(0, 10) + "...");
        setIsLoading(true);
        ndk
          ?.getUser({ pubkey: nprofileData.pubkey })
          .fetchProfile({ cacheUsage: NDKSubscriptionCacheUsage.CACHE_FIRST })
          .then((p) => {
            setProfile(p);
            setDisplayName(p?.displayName || p?.name || profileNpub.substring(0, 10) + "...");
          })
          .catch((e) => console.error(`Failed to fetch profile for ${bareUri}`, e))
          .finally(() => setIsLoading(false));
      } else if (decodedType === "note") {
        setNpub(""); // No user profile to fetch for note
        setTargetPath(`/n/${bareUri}`); // Link to thread page
        setDisplayName(bareUri.substring(0, 10) + "..."); // Display truncated note ID
        setIsLoading(false);
      } else if (decodedType === "nevent") {
        const neventData = decodedData as nip19.EventPointer;
        setNpub("");
        setTargetPath(`/n/${bareUri}`);
        setDisplayName(nip19.noteEncode(neventData.id).substring(0, 10) + "..."); // Display truncated note ID
        setIsLoading(false);
      }
      // Add more types (naddr, nrelay, etc.) if needed
      else {
        setDisplayName(bareUri); // Display unsupported type as is
        setIsValidNostrUri(false); // Treat as non-linkable for now
        setIsLoading(false);
      }
    } catch (e) {
      console.warn(`Failed to decode or process NIP-19 URI: ${uri}`, e);
      setDisplayName(uri); // Display original URI on error
      setIsValidNostrUri(false);
      setIsLoading(false);
    }
  }, [uri, ndk]); // Depend on uri and ndk instance

  if (isLoading) {
    return (
      <Skeleton sx={{ display: "inline-block", ml: 0.5, mr: 0.5 }} variant="text" width={80} />
    );
  }

  if (isValidNostrUri && targetPath !== "#") {
    // Use Tooltip to show full npub/note ID on hover
    return (
      <Tooltip placement="top" title={npub || uri}>
        <Link component={RouterLink} sx={{ fontWeight: "medium" }} to={targetPath}>
          @{displayName}
        </Link>
      </Tooltip>
    );
  }

  // If not a valid/linkable nostr URI or loading failed, render the original text
  // We return the display name which might be the original URI on error
  return <>{displayName}</>;
};

// --- Main Markdown Component ---
type CustomAnchorRenderer = React.FC<
  React.AnchorHTMLAttributes<HTMLAnchorElement> & { node?: any }
>;

// Custom hashtag link component
const HashtagLink: React.FC<{ tag: string; children: React.ReactNode }> = ({ tag, children }) => (
  <RouterLink
    to={`/feed/hashtag/${tag}`}
    className="text-brand-purple hover:text-brand-purple/80 dark:text-brand-yellow dark:hover:text-brand-yellow/80 no-underline"
  >
    {children}
  </RouterLink>
);

// Custom internal link component
const InternalLink: React.FC<{ to: string; children: React.ReactNode }> = ({ to, children }) => (
  <RouterLink
    to={to}
    className="text-brand-purple hover:text-brand-purple/80 dark:text-brand-yellow dark:hover:text-brand-yellow/80 no-underline"
  >
    {children}
  </RouterLink>
);

export const MarkdownContent: React.FC<MarkdownContentProps> = ({ content }) => {
  const { ndk } = useNdk(); // NDK needed for NostrMention

  const LinkRenderer: CustomAnchorRenderer = ({ children, href, node, ...props }) => {
    const targetHref = href || "";

    // Check for nostr: URI first
    if (targetHref.startsWith("nostr:")) {
      // Render the specialized NostrMention component
      return <NostrMention uri={targetHref} />;
    }
    // Internal app links
    else if (targetHref.startsWith("/") || targetHref.startsWith("#")) {
      if (targetHref.startsWith("#")) {
        const tag = targetHref.substring(1);
        return <HashtagLink tag={tag}>{children}</HashtagLink>;
      }
      return <InternalLink to={targetHref}>{children}</InternalLink>;
    }
    // External links
    else {
      return (
        <Link href={targetHref} rel="noopener noreferrer" target="_blank" title={props.title}>
          {children}
        </Link>
      );
    }
  };

  const markdownComponents: Components = {
    a: LinkRenderer,
    // Optional: Override other elements if needed
  };

  // Prevent rendering if NDK is not yet available, as NostrMention needs it
  if (!ndk) {
    return <div className="break-words">{content}</div>; // Render plain text or skeleton
  }

  return (
    <div className="break-words [word-break:break-word]">
      <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  );
};
