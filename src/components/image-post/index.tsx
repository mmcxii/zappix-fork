import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import { Avatar, Link, Skeleton } from "@mui/material";
import {
  NDKEvent,
  NDKFilter,
  NDKKind,
  NDKSubscriptionCacheUsage,
  NDKUser,
  NDKUserProfile,
} from "@nostr-dev-kit/ndk";
import cx from "classnames";
import { decode } from "light-bolt11-decoder";
import {
  Copy,
  EllipsisVertical,
  Heart,
  HeartPlus,
  MessageSquare,
  Repeat,
  Share,
  UserMinus,
  UserPlus,
  Volume2,
  VolumeOff,
  Zap,
} from "lucide-react";
import { nip19 } from "nostr-tools";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { toast } from "sonner";
import { useNdk } from "../../contexts/NdkContext";
import { Collapse } from "../collapse";
import { Button } from "../ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../ui/card";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "../ui/carousel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Loader } from "../ui/icons";
import { MarkdownContent } from "./../MarkdownContent";
import { CardHeaderContent } from "./card-header-content";
import { CommentItem } from "./comment-item";
import { ReportPostDialog } from "./report-post-modal";
import { formatSats } from "./utils";

// Interface must be defined BEFORE the component uses it
interface ImagePostProps {
  event: NDKEvent;
}

const CONTACT_LIST_KIND: NDKKind = 3;
const MUTE_LIST_KIND: NDKKind = 10000;
// const REPORT_KIND: NDKKind = 1984;
const LIKE_KIND: NDKKind = 7;
const REPOST_KIND: NDKKind = 6;
const TEXT_NOTE_KIND: NDKKind = 1;
const ZAP_KIND: NDKKind = 9735;

const parseImetaTag = (tags: string[][]): Record<string, string | string[]> => {
  const metaData: Record<string, string | string[]> = {};
  const imageUrls: string[] = [];

  tags.forEach((tag) => {
    if (tag[0] === "imeta") {
      tag.slice(1).forEach((part) => {
        const spaceIndex = part.indexOf(" ");
        if (spaceIndex > 0) {
          const key = part.substring(0, spaceIndex);
          const value = part.substring(spaceIndex + 1);
          if (key === "url") {
            imageUrls.push(value);
          } else {
            // Store other imeta data if needed, handling potential duplicates or structuring appropriately
            if (metaData[key]) {
              if (Array.isArray(metaData[key])) {
                (metaData[key] as string[]).push(value);
              } else {
                metaData[key] = [metaData[key] as string, value];
              }
            } else {
              metaData[key] = value;
            }
          }
        }
      });
    } else if (tag[0] === "url" && tag[1]) {
      // Handle top-level 'url' tags as well
      imageUrls.push(tag[1]);
    }
  });

  metaData.url = imageUrls.filter((url) => url && url.startsWith("http")); // Filter for valid http urls

  return metaData;
};
const checkSensitiveContent = (
  tags: string[][],
): { isSensitive: boolean; reason: null | string } => {
  let isSensitive = false;
  let reason: null | string = null;
  for (const tag of tags) {
    if (tag[0] === "content-warning") {
      isSensitive = true;
      reason = tag[1] || "Sensitive Content";
      break;
    }
    if (tag[0] === "t" && tag[1]?.toLowerCase() === "nsfw") {
      isSensitive = true;
      reason = reason || "NSFW";
    }
  }
  return { isSensitive, reason };
};

// --- Single, Correct Component Definition ---
export const ImagePost: React.FC<ImagePostProps> = ({ event }) => {
  console.log("Rendering ImagePost for event:", event.id); // Keep log concise

  const { ndk, signer, user: loggedInUser } = useNdk();
  // const navigate = useNavigate();
  const [authorUser, setAuthorUser] = useState<null | NDKUser>(null);
  const [authorProfile, setAuthorProfile] = useState<null | NDKUserProfile>(null);
  const [isLoadingAuthor, setIsLoadingAuthor] = useState<boolean>(true); // Initialize true
  const [isBlurred, setIsBlurred] = useState<boolean>(false);
  const [warningReason, setWarningReason] = useState<null | string>(null);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [isFollowingAuthor, setIsFollowingAuthor] = useState<null | boolean>(null);
  const [isMutingAuthor, setIsMutingAuthor] = useState<null | boolean>(null);
  const [isProcessingFollow, setIsProcessingFollow] = useState(false);
  const [isProcessingMute, setIsProcessingMute] = useState(false);
  const [neventId, setNeventId] = useState<string>("");
  const [likeCount, setLikeCount] = useState<number>(0);
  const [boostCount, setBoostCount] = useState<number>(0);
  const [replyCount, setReplyCount] = useState<number>(0);
  const [zapTotalSats, setZapTotalSats] = useState<number>(0);
  const [hasLiked, setHasLiked] = useState<boolean>(false);
  const [hasBoosted, setHasBoosted] = useState<boolean>(false);
  const [isLoadingReactions, setIsLoadingReactions] = useState<boolean>(true);
  const [isProcessingLike, setIsProcessingLike] = useState<boolean>(false);
  const [isProcessingBoost, setIsProcessingBoost] = useState<boolean>(false);
  const [isProcessingZap, setIsProcessingZap] = useState<boolean>(false);

  // State for comments
  const [showComments, setShowComments] = useState<boolean>(false);
  const [comments, setComments] = useState<NDKEvent[]>([]);
  const [isLoadingComments, setIsLoadingComments] = useState<boolean>(false);
  const [newCommentText, setNewCommentText] = useState<string>("");

  const metadata = useMemo(() => parseImetaTag(event.tags), [event.tags]);
  const imageUrls = useMemo(
    () => (Array.isArray(metadata.url) ? metadata.url : []),
    [metadata.url],
  );
  const altTextTag = event.tags.find((tag) => tag[0] === "alt");
  const altText = altTextTag?.[1] || event.content || "Nostr image post";

  // --- Effects ---
  useEffect(() => {
    const { isSensitive, reason } = checkSensitiveContent(event.tags);
    setIsBlurred(isSensitive);
    setWarningReason(reason);
  }, [event.tags]);

  // Fetch author profile effect
  useEffect(() => {
    let isMounted = true; // Track mount status for this effect
    if (ndk && event.pubkey) {
      console.log(`ImagePost (${event.id}): Fetching profile for ${event.pubkey}`);
      setIsLoadingAuthor(true);
      setAuthorUser(null); // Reset crucial states if event.pubkey changes
      setAuthorProfile(null);
      const userInstance = ndk.getUser({ pubkey: event.pubkey });
      setAuthorUser(userInstance); // Set user object immediately

      userInstance
        .fetchProfile({ cacheUsage: NDKSubscriptionCacheUsage.CACHE_FIRST })
        .then((profile) => {
          if (isMounted) {
            // Only update state if component is still mounted
            console.log(`ImagePost (${event.id}): Profile fetched for ${event.pubkey}`, profile);
            setAuthorProfile(profile);
          }
        })
        .catch((err) => {
          if (isMounted)
            console.error(`ImagePost (${event.id}): Failed profile fetch ${event.pubkey}:`, err);
        })
        .finally(() => {
          if (isMounted) {
            console.log(
              `ImagePost (${event.id}): Finished profile fetch attempt for ${event.pubkey}`,
            );
            setIsLoadingAuthor(false);
          }
        });
    } else {
      setIsLoadingAuthor(false); // Not loading if no NDK or pubkey
    }
    return () => {
      isMounted = false;
    };
  }, [ndk, event.pubkey]); // Re-run ONLY if ndk instance or event\'s pubkey changes

  // Generate nevent ID effect
  useEffect(() => {
    try {
      const encoded = nip19.neventEncode({
        author: event.pubkey,
        id: event.id,
        relays: event.relay ? [event.relay.url] : undefined,
      });
      setNeventId(encoded);
    } catch (e) {
      console.error("Error encoding nevent:", e);
      setNeventId("");
    }
  }, [event.id, event.relay, event.pubkey]);

  // Fetch follow/mute status effect
  useEffect(() => {
    if (!ndk || !loggedInUser || loggedInUser.pubkey === event.pubkey) {
      setIsFollowingAuthor(false);
      setIsMutingAuthor(false);
      return;
    }
    setIsFollowingAuthor(null);
    setIsMutingAuthor(null);
    const authorPubkey = event.pubkey;
    let isMounted = true;
    const checkStatus = async () => {
      try {
        const contactFilter: NDKFilter = {
          authors: [loggedInUser.pubkey],
          kinds: [CONTACT_LIST_KIND],
          limit: 1,
        };
        const contactListEvent = await ndk.fetchEvent(contactFilter, {
          cacheUsage: NDKSubscriptionCacheUsage.CACHE_FIRST,
        });
        if (isMounted) {
          const foundFollow = !!contactListEvent?.tags.some(
            (t) => t[0] === "p" && t[1] === authorPubkey,
          );
          setIsFollowingAuthor(foundFollow);
        }
        const muteFilter: NDKFilter = {
          authors: [loggedInUser.pubkey],
          kinds: [MUTE_LIST_KIND],
          limit: 1,
        };
        const muteListEvent = await ndk.fetchEvent(muteFilter, {
          cacheUsage: NDKSubscriptionCacheUsage.CACHE_FIRST,
        });
        if (isMounted) {
          const foundMute = !!muteListEvent?.tags.some(
            (t) => t[0] === "p" && t[1] === authorPubkey,
          );
          setIsMutingAuthor(foundMute);
        }
      } catch (err) {
        console.error("Failed fetch initial follow/mute:", err);
        if (isMounted) {
          setIsFollowingAuthor(false);
          setIsMutingAuthor(false);
        }
      }
    };
    checkStatus();
    return () => {
      isMounted = false;
    };
  }, [ndk, loggedInUser, event.pubkey]);

  // Fetch reactions effect
  useEffect(() => {
    if (!ndk || !event || !event.id) return;
    setIsLoadingReactions(true);
    setHasLiked(false);
    setHasBoosted(false); // Reset on event change
    let isSubscribed = true;
    const eventId = event.id;
    const userPubkey = loggedInUser?.pubkey;
    const fetchReactions = async () => {
      try {
        const likeFilter: NDKFilter = { "#e": [eventId], kinds: [LIKE_KIND] };
        const boostFilter: NDKFilter = {
          "#e": [eventId],
          kinds: [REPOST_KIND],
        };
        const replyFilter: NDKFilter = {
          "#e": [eventId],
          kinds: [TEXT_NOTE_KIND],
        };
        const zapFilter: NDKFilter = { "#e": [eventId], kinds: [ZAP_KIND] };
        const [likeEvents, boostEvents, replyEvents] = await Promise.all([
          ndk
            .fetchEvents(likeFilter, {
              cacheUsage: NDKSubscriptionCacheUsage.CACHE_FIRST,
            })
            .catch(() => new Set<NDKEvent>()),
          ndk
            .fetchEvents(boostFilter, {
              cacheUsage: NDKSubscriptionCacheUsage.CACHE_FIRST,
            })
            .catch(() => new Set<NDKEvent>()),
          ndk
            .fetchEvents(replyFilter, {
              cacheUsage: NDKSubscriptionCacheUsage.CACHE_FIRST,
            })
            .catch(() => new Set<NDKEvent>()),
        ]);
        if (!isSubscribed) return;
        setLikeCount(likeEvents.size);
        setBoostCount(boostEvents.size);
        setReplyCount(replyEvents.size);
        if (userPubkey) {
          const [userLikeEvent, userBoostEvent] = await Promise.all([
            ndk
              .fetchEvent(
                { ...likeFilter, authors: [userPubkey], limit: 1 },
                { cacheUsage: NDKSubscriptionCacheUsage.CACHE_FIRST },
              )
              .catch(() => null),
            ndk
              .fetchEvent(
                { ...boostFilter, authors: [userPubkey], limit: 1 },
                { cacheUsage: NDKSubscriptionCacheUsage.CACHE_FIRST },
              )
              .catch(() => null),
          ]);
          if (!isSubscribed) return;
          setHasLiked(!!userLikeEvent);
          setHasBoosted(!!userBoostEvent);
        }
        const zapEvents = await ndk.fetchEvents(zapFilter, {
          cacheUsage: NDKSubscriptionCacheUsage.CACHE_FIRST,
        });
        if (!isSubscribed) return;
        let totalSats = 0;
        zapEvents.forEach((zapReceiptEvent) => {
          try {
            const descriptionTag = zapReceiptEvent.tags.find((t) => t[0] === "description");
            if (descriptionTag && descriptionTag[1]) {
              const zapRequestString = descriptionTag[1];
              const zapRequestData = JSON.parse(zapRequestString);
              const zapRequestTags = zapRequestData.tags || [];
              const bolt11Tag = zapRequestTags.find((t: string[]) => t[0] === "bolt11");
              if (bolt11Tag && bolt11Tag[1]) {
                const bolt11Invoice = bolt11Tag[1];
                const decodedInvoice = decode(bolt11Invoice);
                const amountSection = decodedInvoice.sections?.find((s) => s.name === "amount");
                if (amountSection?.value && typeof amountSection.value === "number") {
                  totalSats += amountSection.value / 1000;
                } else if (amountSection?.value && typeof amountSection.value === "string") {
                  try {
                    totalSats += parseInt(amountSection.value, 10) / 1000;
                  } catch (e) {}
                }
              }
            }
          } catch (e) {
            console.error(`Error processing zap event: ${zapReceiptEvent.id}`, e);
          }
        });
        if (isSubscribed) setZapTotalSats(totalSats);
      } catch (err) {
        console.error("Error fetching reactions:", err);
      } finally {
        if (isSubscribed) setIsLoadingReactions(false);
      }
    };
    fetchReactions();
    return () => {
      isSubscribed = false;
    };
  }, [ndk, event.id, event.pubkey, loggedInUser?.pubkey]); // Re-fetch reactions if event or user changes

  // Fetch comments effect and function
  const fetchComments = useCallback(async () => {
    if (!ndk || !event?.id) return;
    setIsLoadingComments(true);
    try {
      const commentsFilter: NDKFilter = {
        "#e": [event.id],
        kinds: [1111],
      };
      const fetchedComments = await ndk.fetchEvents(commentsFilter, {
        cacheUsage: NDKSubscriptionCacheUsage.CACHE_FIRST,
      });
      const commentsArray = Array.from(fetchedComments);
      setComments(commentsArray);

      // Fetch author profiles for comments
      const authorPubkeys = commentsArray.map((comment) => comment.pubkey);
      if (authorPubkeys.length > 0) {
        const profileFilter: NDKFilter = {
          authors: authorPubkeys,
          kinds: [0],
        };
        await ndk.fetchEvents(profileFilter, {
          cacheUsage: NDKSubscriptionCacheUsage.CACHE_FIRST,
        });
        // Profiles will be available in NDK cache, and components rendering comments can access them
      }
    } catch (error) {
      console.error("Error fetching comments:", error);
      setComments([]);
    } finally {
      setIsLoadingComments(false);
    }
  }, [ndk, event?.id]);

  // Effect to fetch comments when showComments becomes true
  useEffect(() => {
    if (showComments && comments.length === 0 && !isLoadingComments) {
      fetchComments();
    }
  }, [showComments, comments.length, isLoadingComments, fetchComments]);

  // Submit comment function
  const submitComment = useCallback(async () => {
    if (!ndk || !signer || !loggedInUser || !newCommentText.trim() || !event?.id || !event?.pubkey)
      return;

    const toastId = "comment-toast";
    toast.loading("Posting comment...", { id: toastId });

    try {
      const commentEvent = new NDKEvent(ndk);
      commentEvent.kind = 1111; // NIP-22 Comment Kind
      commentEvent.content = newCommentText.trim();

      // Add tags according to NIP-22
      const tags = [
        // Root scope: Image Post Event
        ["E", event.id, event.relay?.url || "", event.pubkey],
        ["K", event.kind.toString()],
        ["P", event.pubkey, event.relay?.url || ""],

        // Parent item: For a top-level comment, parent is the same as root
        ["e", event.id, event.relay?.url || "", event.pubkey],
        ["k", event.kind.toString()],
        ["p", event.pubkey, event.relay?.url || ""],

        // Tag the author of the image post (optional based on content, but good practice)
        ["p", event.pubkey],
      ];

      // Add any mentioned users as p tags
      // This part would require more sophisticated parsing of the newCommentText
      // For now, we'll just add the basic required tags.

      commentEvent.tags = tags;

      await commentEvent.sign(signer);
      const published = await commentEvent.publish();

      if (published.size > 0) {
        toast.success("Comment posted!", { id: toastId });
        setNewCommentText("");
        // Optionally refetch comments or add the new comment to the list
        fetchComments(); // Refetch comments to include the new one
      } else {
        toast.error("Failed to publish comment.", { id: toastId });
      }
    } catch (error) {
      console.error("Comment post error:", error);
      toast.error(`Comment failed: ${error instanceof Error ? error.message : "Unknown"}`, {
        id: toastId,
      });
    }
  }, [ndk, signer, loggedInUser, newCommentText, event, fetchComments]);

  // --- Action Handlers ---
  const handleLike = useCallback(async () => {
    if (!ndk || !signer || !loggedInUser || isProcessingLike) return;
    setIsProcessingLike(true);
    const toastId = "like-toast";
    toast.loading(hasLiked ? "Unliking..." : "Liking...", { id: toastId });
    try {
      if (hasLiked) {
        toast.error("Unlike not implemented yet.", { id: toastId });
        setIsProcessingLike(false);
        return;
      } else {
        const likeEvent = new NDKEvent(ndk);
        likeEvent.kind = LIKE_KIND;
        likeEvent.content = "+";
        likeEvent.tags = [
          ["e", event.id, "", "root"],
          ["p", event.pubkey],
        ];
        await likeEvent.sign(signer);
        const published = await likeEvent.publish();
        if (published.size > 0) {
          toast.success("Liked!", { id: toastId });
          setHasLiked(true);
          setLikeCount((c) => c + 1);
        } else {
          toast.error("Failed to publish like.", { id: toastId });
        }
      }
    } catch (error) {
      console.error("Like error:", error);
      toast.error(`Like failed: ${error instanceof Error ? error.message : "Unknown"}`, {
        id: toastId,
      });
    } finally {
      setIsProcessingLike(false);
    }
  }, [ndk, signer, loggedInUser, event.id, event.pubkey, hasLiked, isProcessingLike]);
  const handleBoost = useCallback(async () => {
    if (!ndk || !signer || !loggedInUser || isProcessingBoost) return;
    setIsProcessingBoost(true);
    const toastId = "boost-toast";
    toast.loading(hasBoosted ? "Unboosting..." : "Boosting...", {
      id: toastId,
    });
    try {
      if (hasBoosted) {
        toast.error("Unboost not implemented yet.", { id: toastId });
        setIsProcessingBoost(false);
        return;
      } else {
        const boostEvent = new NDKEvent(ndk);
        boostEvent.kind = REPOST_KIND;
        boostEvent.content = "";
        boostEvent.tags = [
          ["e", event.id, "", ""],
          ["p", event.pubkey],
        ];
        await boostEvent.sign(signer);
        const published = await boostEvent.publish();
        if (published.size > 0) {
          toast.success("Boosted!", { id: toastId });
          setHasBoosted(true);
          setBoostCount((c) => c + 1);
        } else {
          toast.error("Failed to publish boost.", { id: toastId });
        }
      }
    } catch (error) {
      console.error("Boost error:", error);
      toast.error(`Boost failed: ${error instanceof Error ? error.message : "Unknown"}`, {
        id: toastId,
      });
    } finally {
      setIsProcessingBoost(false);
    }
  }, [ndk, signer, loggedInUser, event.id, event.pubkey, hasBoosted, isProcessingBoost]);
  const handleZap = useCallback(() => {
    if (!loggedInUser) {
      toast.error("Please log in to Zap.");
      return;
    }
    if (!authorProfile?.lud16) {
      toast.error("Author does not have a Lightning Address set up.");
      return;
    }
    toast("Zap function not fully implemented!", { icon: "⚡" });
    setIsProcessingZap(false);
  }, [loggedInUser, authorProfile]); // Simplified deps for placeholder

  // Modified handleReply to toggle comments section
  const handleReply = useCallback(() => {
    setShowComments((prev) => !prev);
  }, [setShowComments]);

  const handleMenuClose = () => setAnchorEl(null);
  const handleCopyNevent = () => {
    if (neventId) {
      navigator.clipboard
        .writeText(neventId)
        .then(() => toast.success("Note ID (nevent) copied!"))
        .catch(() => toast.error("Failed to copy Note ID."));
    } else {
      toast.error("Could not generate Note ID.");
    }
    handleMenuClose();
  };
  const handleShare = async () => {
    const shareUrl = `https://njump.me/${neventId}`;
    const shareTitle = `Nostr post by ${
      authorProfile?.displayName || event.pubkey.substring(0, 10)
    }...`;
    const shareText = altText;
    if (navigator.share && neventId) {
      try {
        await navigator.share({
          text: shareText,
          title: shareTitle,
          url: shareUrl,
        });
        toast.success("Shared successfully!");
      } catch (err: any) {
        if (err.name !== "AbortError") {
          console.error("Error sharing:", err);
          toast.error(`Could not share: ${err.message}`);
        }
      }
    } else if (neventId) {
      navigator.clipboard
        .writeText(shareUrl)
        .then(() => toast.success("Share URL (njump.me) copied!"))
        .catch(() => toast.error("Failed to copy Share URL."));
    } else {
      toast.error("Could not generate Share URL.");
    }
    handleMenuClose();
  };
  // --- handleFollowToggle, handleMuteToggle, handleReportClick, handleReportSubmit (Unchanged) ---
  const handleFollowToggle = async () => {
    if (
      !loggedInUser ||
      !signer ||
      !ndk ||
      isProcessingFollow ||
      loggedInUser.pubkey === event.pubkey
    )
      return;
    const targetPubkey = event.pubkey;
    const currentlyFollowing = isFollowingAuthor;
    const actionToastId = "follow-toast";
    setIsProcessingFollow(true);
    handleMenuClose();
    toast.loading(currentlyFollowing ? "Unfollowing..." : "Following...", {
      id: actionToastId,
    });
    try {
      const filter: NDKFilter = {
        authors: [loggedInUser.pubkey],
        kinds: [CONTACT_LIST_KIND],
        limit: 1,
      };
      const currentContactListEvent = await ndk.fetchEvent(filter, {
        cacheUsage: NDKSubscriptionCacheUsage.CACHE_FIRST,
      });
      let currentTags: string[][] = currentContactListEvent ? currentContactListEvent.tags : [];
      let newTags: string[][] = [];
      if (currentlyFollowing) {
        newTags = currentTags.filter((tag) => !(tag[0] === "p" && tag[1] === targetPubkey));
      } else {
        if (!currentTags.some((tag) => tag[0] === "p" && tag[1] === targetPubkey)) {
          newTags = [...currentTags, ["p", targetPubkey]];
        } else {
          newTags = currentTags;
        }
      }
      if (newTags.length === currentTags.length && currentlyFollowing === false) {
        toast.success("Already following.", { id: actionToastId });
        setIsProcessingFollow(false);
        setIsFollowingAuthor(true);
        return;
      }
      const newEvent = new NDKEvent(ndk);
      newEvent.kind = CONTACT_LIST_KIND;
      newEvent.created_at = Math.floor(Date.now() / 1000);
      newEvent.tags = newTags;
      newEvent.content = currentContactListEvent?.content || "";
      await newEvent.sign(signer);
      const publishedRelays = await newEvent.publish();
      if (publishedRelays.size > 0) {
        toast.success(currentlyFollowing ? "Unfollowed!" : "Followed!", {
          id: actionToastId,
        });
        setIsFollowingAuthor(!currentlyFollowing);
      } else {
        toast.error("Failed to publish contact list update.", {
          id: actionToastId,
        });
        throw new Error("Publish failed");
      }
    } catch (error) {
      toast.error(`Failed to ${currentlyFollowing ? "unfollow" : "follow"}.`, {
        id: actionToastId,
      });
      console.error("Follow/Unfollow Error:", error);
    } finally {
      setIsProcessingFollow(false);
    }
  };

  const handleMuteToggle = async () => {
    if (
      !loggedInUser ||
      !signer ||
      !ndk ||
      isProcessingMute ||
      loggedInUser.pubkey === event.pubkey
    )
      return;
    const targetPubkey = event.pubkey;
    const currentlyMuted = isMutingAuthor;
    const actionToastId = "mute-toast";
    setIsProcessingMute(true);
    handleMenuClose();
    toast.loading(currentlyMuted ? "Unmuting..." : "Muting...", {
      id: actionToastId,
    });
    try {
      const filter: NDKFilter = {
        authors: [loggedInUser.pubkey],
        kinds: [MUTE_LIST_KIND],
        limit: 1,
      };
      const currentMuteListEvent = await ndk.fetchEvent(filter, {
        cacheUsage: NDKSubscriptionCacheUsage.CACHE_FIRST,
      });
      let currentTags: string[][] = currentMuteListEvent ? currentMuteListEvent.tags : [];
      let newTags: string[][] = [];
      if (currentlyMuted) {
        newTags = currentTags.filter((tag) => !(tag[0] === "p" && tag[1] === targetPubkey));
      } else {
        if (!currentTags.some((tag) => tag[0] === "p" && tag[1] === targetPubkey)) {
          newTags = [...currentTags, ["p", targetPubkey]];
        } else {
          newTags = currentTags;
        }
      }
      if (newTags.length === currentTags.length && currentlyMuted === false) {
        toast.success("Already muted.", { id: actionToastId });
        setIsProcessingMute(false);
        setIsMutingAuthor(true);
        return;
      }
      const newEvent = new NDKEvent(ndk);
      newEvent.kind = MUTE_LIST_KIND;
      newEvent.created_at = Math.floor(Date.now() / 1000);
      newEvent.tags = newTags;
      newEvent.content = "";
      await newEvent.sign(signer);
      const publishedRelays = await newEvent.publish();
      if (publishedRelays.size > 0) {
        toast.success(currentlyMuted ? "Unmuted!" : "Muted!", {
          id: actionToastId,
        });
        setIsMutingAuthor(!currentlyMuted);
      } else {
        toast.error("Failed to publish mute list update.", {
          id: actionToastId,
        });
        throw new Error("Publish failed");
      }
    } catch (error) {
      toast.error(`Failed to ${currentlyMuted ? "unmute" : "mute"}.`, {
        id: actionToastId,
      });
      console.error("Mute/Unmute Error:", error);
    } finally {
      setIsProcessingMute(false);
    }
  };

  const handleReportSubmit = async (reportType: string, reasonText: string) => {
    if (!ndk || !loggedInUser || !signer) {
      toast.error("Cannot submit report: NDK, user, or signer missing.");
      return;
    }
    setIsSubmittingReport(true);
    const reportToastId = "report-toast";
    toast.loading("Submitting report...", { id: reportToastId });
    try {
      const reportEvent = new NDKEvent(ndk);
      reportEvent.kind = 1984;
      reportEvent.created_at = Math.floor(Date.now() / 1000);
      reportEvent.tags = [
        ["e", event.id],
        ["p", event.pubkey],
        ["report", reportType],
      ];
      reportEvent.content = reasonText || "";
      await reportEvent.sign(signer);
      const publishedRelays = await reportEvent.publish();
      if (publishedRelays.size > 0) {
        toast.success("Report submitted successfully!", { id: reportToastId });
      } else {
        toast.error("Failed to publish report to any connected write relays.", {
          id: reportToastId,
        });
      }
    } catch (error) {
      console.error("Error submitting NIP-56 report:", error);
      toast.error(
        `Failed to submit report: ${error instanceof Error ? error.message : String(error)}`,
        { id: reportToastId },
      );
    } finally {
      setIsSubmittingReport(false);
    }
  };

  const handleImageClick = () => {
    if (isBlurred) {
      setIsBlurred(false);
    }
  };

  // --- Rendering ---
  // Condition 1: Basic data check (check if imageUrls has any valid http urls)
  const validImageUrls = imageUrls.filter((url) => url?.startsWith("http"));
  if (validImageUrls.length === 0) {
    console.warn(`Skipping render: No valid imageUrls for event ${event.id}`);
    return null;
  }

  // Condition 2: Show Skeleton while author profile is loading
  if (isLoadingAuthor) {
    console.log(`Rendering Skeleton for event ${event.id} because isLoadingAuthor is true`);
    return (
      <Card>
        <CardHeader>
          <CardHeaderContent
            author={
              <Skeleton animation="wave" height={10} style={{ marginBottom: 6 }} width="40%" />
            }
            avatar={<Skeleton animation="wave" height={40} variant="circular" width={40} />}
            createdAt={<Skeleton animation="wave" height={10} width="20%" />}
          />
        </CardHeader>
        <Skeleton animation="wave" sx={{ height: 300 }} variant="rectangular" />
        <CardContent>
          <Skeleton animation="wave" height={10} style={{ marginBottom: 6 }} />
          <Skeleton animation="wave" height={10} width="80%" />
        </CardContent>
      </Card>
    );
  }

  // Condition 3: If loading finished, but authorUser still wasn\'t set
  if (!authorUser) {
    console.warn(`Skipping render: authorUser is null after loading attempt for event ${event.id}`);
    return null; // Or render an error placeholder
  }

  // --- Proceed with rendering now that authorUser is available ---
  const authorDisplayName =
    authorProfile?.displayName || authorProfile?.name || authorUser.npub.substring(0, 10) + "...";
  const authorAvatarUrl = authorProfile?.image?.startsWith("http")
    ? authorProfile.image
    : undefined;
  const isMenuOpen = Boolean(anchorEl);
  const isOwnPost = loggedInUser?.pubkey === event.pubkey;

  return (
    <Card>
      <CardHeader>
        <CardHeaderContent
          action={
            (loggedInUser || neventId) && (
              <CardAction>
                <DropdownMenu>
                  <DropdownMenuTrigger>
                    <Button
                      aria-controls={isMenuOpen ? `post-action-menu-${event.id}` : undefined}
                      aria-expanded={isMenuOpen ? "true" : undefined}
                      aria-haspopup="true"
                      aria-label="settings"
                      className="!bg-[initial]"
                      variant="tertiary"
                    >
                      <EllipsisVertical className="size-5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {neventId && (
                      <DropdownMenuItem onClick={handleCopyNevent}>
                        <Copy />
                        Copy Note ID
                      </DropdownMenuItem>
                    )}
                    {neventId && (
                      <DropdownMenuItem onClick={handleShare}>
                        <Share />
                        Share
                      </DropdownMenuItem>
                    )}
                    {loggedInUser && !isOwnPost && (
                      <DropdownMenuItem
                        disabled={isFollowingAuthor === null || isProcessingFollow}
                        onClick={handleFollowToggle}
                      >
                        {isProcessingFollow ? (
                          <Loader />
                        ) : isFollowingAuthor ? (
                          <UserMinus />
                        ) : (
                          <UserPlus />
                        )}
                        {isFollowingAuthor ? "Unfollow Author" : "Follow Author"}
                      </DropdownMenuItem>
                    )}
                    {loggedInUser && !isOwnPost && (
                      <DropdownMenuItem
                        disabled={isMutingAuthor === null || isProcessingMute}
                        onClick={handleMuteToggle}
                      >
                        {isProcessingMute ? (
                          <Loader />
                        ) : isMutingAuthor ? (
                          <Volume2 />
                        ) : (
                          <VolumeOff />
                        )}
                        {isMutingAuthor ? "Unmute Author" : "Mute Author"}
                      </DropdownMenuItem>
                    )}
                    {loggedInUser && !isOwnPost && (
                      <DropdownMenuItem disabled={isSubmittingReport}>
                        <ReportPostDialog event={event} onSubmit={handleReportSubmit} />
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardAction>
            )
          }
          author={
            <CardTitle>
              <Link
                color="inherit"
                component={RouterLink}
                to={`/profile/${authorUser.npub}`}
                underline="hover"
              >
                {authorDisplayName}
              </Link>
            </CardTitle>
          }
          avatar={
            <Avatar
              aria-label="author avatar"
              component={RouterLink}
              src={authorAvatarUrl}
              to={`/profile/${authorUser.npub}`}
            >
              {!authorAvatarUrl && authorDisplayName.charAt(0).toUpperCase()}
            </Avatar>
          }
          createdAt={
            <CardDescription>{new Date(event.created_at! * 1000).toLocaleString()}</CardDescription>
          }
        />
      </CardHeader>

      <CardContent>
        <div
          className={cx("relative mt-2 flex w-full flex-col items-center gap-2", {
            "cursor-pointer": isBlurred,
          })}
          onClick={handleImageClick}
        >
          {validImageUrls.length === 1 && (
            <img
              alt={altText}
              className={cx(
                "transition-filter max-h-[80vh] w-full rounded object-contain duration-300 ease-in-out",
                {
                  "blur-xl": isBlurred,
                },
              )}
              src={validImageUrls[0]}
            />
          )}
          {validImageUrls.length !== 1 && (
            <Carousel className="w-full max-w-sm md:max-w-md">
              <CarouselContent>
                {validImageUrls.map((url) => (
                  <CarouselItem key={url}>
                    <img
                      alt={altText}
                      className={cx(
                        "transition-filter max-h-[80vh]rounded object-contain duration-300 ease-in-out",
                        {
                          "blur-xl": isBlurred,
                        },
                      )}
                      src={url}
                    />
                  </CarouselItem>
                ))}
              </CarouselContent>
              <CarouselPrevious />
              <CarouselNext />
            </Carousel>
          )}

          {isBlurred && (
            <div className="absolute right-0 bottom-0 left-0 flex h-full flex-col items-center justify-center bg-[0,0,0,0.5] p-2 text-center text-white">
              <VisibilityOffIcon className="mb-1 !text-4xl" />
              <span>{warningReason ?? "Content Warning"}</span>
              <span className="text-sm">View content</span>
            </div>
          )}
        </div>

        {event.content != null && (
          <div className="pt-1 pb-2">
            <p className="text-gray-700 dark:text-gray-300">
              <MarkdownContent content={event.content} />
            </p>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex flex-col">
        <div className="flex w-full justify-between gap-2 p-2 text-center">
          <Button
            className="flex items-center justify-center gap-1"
            disabled={loggedInUser == null || isProcessingLike}
            onClick={handleLike}
            variant="tertiary"
          >
            {isProcessingLike ? (
              <Loader />
            ) : hasLiked ? (
              <Heart className="text-red-500" />
            ) : (
              <HeartPlus className="text-brand-purple" />
            )}
            {isLoadingReactions ? <Loader /> : likeCount > 0 ? likeCount : ""}
          </Button>
          <Button
            className="flex items-center justify-center gap-1"
            disabled={loggedInUser == null || isProcessingBoost}
            onClick={handleBoost}
            variant="tertiary"
          >
            {isProcessingBoost ? (
              <Loader />
            ) : (
              <Repeat
                className={cx({
                  "text-brand-purple": !hasBoosted,
                  "text-green-500": hasBoosted,
                })}
              />
            )}
            {isLoadingReactions ? <Loader /> : boostCount > 0 ? boostCount : ""}
          </Button>
          <Button
            className="flex items-center justify-center gap-1"
            onClick={handleReply}
            variant="tertiary"
          >
            <MessageSquare className="text-brand-purple" />
            {isLoadingReactions ? <Loader /> : replyCount > 0 ? replyCount : ""}
          </Button>
          <Button
            className="flex items-center justify-center gap-1"
            disabled={loggedInUser == null || isProcessingZap || authorProfile?.lud16 == null}
            onClick={handleZap}
            title={authorProfile?.lud16 == null ? "Author has no Lightning Address" : undefined}
            variant="tertiary"
          >
            {isProcessingZap ? <Loader /> : <Zap className="text-brand-yellow" />}
            {isLoadingReactions ? <Loader /> : zapTotalSats > 0 ? formatSats(zapTotalSats) : ""}
          </Button>
        </div>

        <Collapse className="w-full" isOpen={showComments}>
          <div className="flex flex-col gap-3 pb-2">
            <span className="text-lg">Comments</span>
            {isLoadingComments ? (
              <div className="flex flex-col justify-center gap-1">
                <Loader />
              </div>
            ) : comments.length > 0 ? (
              <div>
                {comments.map((comment) => (
                  <CommentItem commentEvent={comment} key={comment.id} ndk={ndk} />
                ))}
              </div>
            ) : (
              <p className="text-gray-700 dark:text-gray-300">No comments yet.</p>
            )}
            {loggedInUser && (
              <div className="flex items-center gap-1">
                <input
                  className="w-full rounded border-1 border-gray-500 p-2"
                  onChange={(e) => setNewCommentText(e.target.value)}
                  placeholder="Add a comment"
                  value={newCommentText}
                />
                <Button
                  disabled={!newCommentText.trim()}
                  onClick={submitComment}
                  variant="tertiary"
                >
                  Post
                </Button>
              </div>
            )}
          </div>
        </Collapse>
      </CardFooter>
    </Card>
  );
};

// Ensure this helper function exists or is imported
