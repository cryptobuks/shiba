/* Parser for the !profit command. This parses either a time range
   like "12h 30m" or a range of games.
*/

%{
const _ = require('lodash');
%}

%lex
/* flex means longest-match semantics */
%options flex case-insensitive

INT    [1-9][0-9]*

WEEK     {INT}"w"
DAY      {INT}"d"
HOUR     {INT}"h"
MINUTE   {INT}"m"
SECOND   {INT}"s"
AT       "@"
U        [a-z0-9_\-]
USERNAME {AT}?{U}{U}{U}+

%%

\s+          /* skip whitespace */

{WEEK}       return 'WEEK';
{DAY}        return 'DAY';
{HOUR}       return 'HOUR';
{MINUTE}     return 'MINUTE';
{SECOND}     return 'SECOND';
/* Keep 'GAMES' before 'USERNAME'. Usernames that are numbers need to
   be explicitly tagged with "@". */
{INT}        return 'GAMES';
{USERNAME}   return 'USERNAME';

<<EOF>>      return 'EOF';
.            return 'INVALID';

/lex

%start line
%%

timesecond
  : SECOND -> parseInt(yytext)
  ;
timeminute
  : MINUTE timesecond -> parseInt(yytext)*60 + $1
  | MINUTE -> parseInt(yytext)*60
  | timesecond -> $1
  ;
timehour
  : HOUR timeminute -> parseInt(yytext)*60*60 + $1
  | HOUR -> parseInt(yytext)*60*60
  | timeminute -> $1
  ;
timeday
  : DAY timehour -> parseInt(yytext)*24*60*60 + $1
  | DAY -> parseInt(yytext)*24*60*60
  | timehour -> $1
  ;
timeweek
  : WEEK timeday -> parseInt(yytext)*7*24*60*60 + $1
  | WEEK -> parseInt(yytext)*7*24*60*60
  | timeday -> $1
  ;

/* As a summary the two query options. */
timeago
  : timeweek -> $1 * 1000 /* convert to milliseconds here */
  ;
games
  : GAMES -> parseInt($1)
  ;

username
  : USERNAME -> yytext.replace(/^@/, '')
  ;
command
  : username timeago  -> { user: $1, time: $2 }
  | timeago           -> { time: $1 }
  | username games    -> { user: $1, games: $2 }
  | games             -> { games: $1 }
  ;
line
  : command EOF -> $1; return $1;
  ;
