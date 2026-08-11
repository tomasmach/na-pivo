/**
 * The people inbox as a stack route OUTSIDE (tabs).
 *
 * The same screen also lives at /friends/parta/people, but pushing that copy
 * from Profil would move the tab bar to Kocoviny while you never left Profil.
 * This route keeps the tab you came from and gives back the native back swipe.
 */
export { default } from '@/friends/PartaPeopleScreen';
