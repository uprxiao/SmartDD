// Bounded, local Core Text metrics. No documents, URLs or executables are
// accepted; a missing requested face is an error, never silent substitution.
template<typename T> struct OfficeCF {
  T value; explicit OfficeCF(T v):value(v){} ~OfficeCF(){if(value)CFRelease(value);}
  OfficeCF(const OfficeCF&)=delete; OfficeCF& operator=(const OfficeCF&)=delete;
};
static double officeMetricNumber(id value,double low,double high) {
  require([value isKindOfClass:NSNumber.class],"INVALID_INPUT","Invalid font measurement number");
  double number=[value doubleValue];require(std::isfinite(number) && number>=low && number<=high,"INVALID_INPUT","Font measurement number outside budget");return number;
}
static NSDictionary *officeMeasureOperation(NSDictionary *request) {
  require([NSJSONSerialization dataWithJSONObject:request options:0 error:nil].length<=8ull*1024*1024,"TOO_LARGE","Font measurement exceeds 8 MiB");
  OfficeCF<CFArrayRef> families(CTFontManagerCopyAvailableFontFamilyNames()),names(CTFontManagerCopyAvailablePostScriptNames());
  NSMutableDictionary<NSString*,id> *cache=[NSMutableDictionary dictionary];NSMutableSet<NSString*> *used=[NSMutableSet set];
  auto font=[&](NSDictionary *spec)->CTFontRef {
    require([spec isKindOfClass:NSDictionary.class],"INVALID_INPUT","Font description required");
    NSString *family=spec[@"family"];require([family isKindOfClass:NSString.class] && family.length>0 && family.length<=256,"INVALID_INPUT","Invalid font family");
    require([family rangeOfCharacterFromSet:NSCharacterSet.controlCharacterSet].location==NSNotFound,"INVALID_INPUT","Invalid font family characters");
    double points=officeMetricNumber(spec[@"points"],1,409);bool bold=[spec[@"bold"] boolValue],italic=[spec[@"italic"] boolValue];
    NSString *key=[NSString stringWithFormat:@"%@|%.6f|%d|%d",family,points,bold,italic];if(cache[key])return (__bridge CTFontRef)cache[key];
    require(cache.count<512,"TOO_LARGE","Too many distinct font faces");
    NSString *available=nil;bool postscript=false;
    for(NSString *name in (__bridge NSArray*)families.value)if([name caseInsensitiveCompare:family]==NSOrderedSame){available=name;break;}
    if(!available)for(NSString *name in (__bridge NSArray*)names.value)if([name caseInsensitiveCompare:family]==NSOrderedSame){available=name;postscript=true;break;}
    if(!available)fail("UNSUPPORTED","本机缺少字体："+str(family)+"；原尺寸保留");
    CTFontSymbolicTraits traits=(bold ? kCTFontBoldTrait : 0)|(italic ? kCTFontItalicTrait : 0);
    NSDictionary *attrs=@{(__bridge NSString*)(postscript ? kCTFontNameAttribute : kCTFontFamilyNameAttribute):available,(__bridge NSString*)kCTFontTraitsAttribute:@{(__bridge NSString*)kCTFontSymbolicTrait:@(traits)}};
    OfficeCF<CTFontDescriptorRef> descriptor(CTFontDescriptorCreateWithAttributes((__bridge CFDictionaryRef)attrs));
    CTFontRef result=CTFontCreateWithFontDescriptorAndOptions(descriptor.value,points*4/3,nullptr,kCTFontOptionsPreventAutoActivation);
    require(result!=nullptr,"IO","Could not create font metrics");
    id owned=CFBridgingRelease(result);
    OfficeCF<CFStringRef> actual(postscript ? CTFontCopyPostScriptName(result) : CTFontCopyFamilyName(result));
    if([(__bridge NSString*)actual.value caseInsensitiveCompare:available]!=NSOrderedSame || (CTFontGetSymbolicTraits(result)&(kCTFontBoldTrait|kCTFontItalicTrait))!=traits)fail("UNSUPPORTED","本机缺少指定字体样式："+str(family)+"；原尺寸保留");
    cache[key]=owned;return result;
  };
  CTFontRef normal=font(request[@"normalFont"]);
  UniChar digits[10]={'0','1','2','3','4','5','6','7','8','9'};CGGlyph glyphs[10];CGSize advances[10];
  require(CTFontGetGlyphsForCharacters(normal,digits,glyphs,10),"UNSUPPORTED","Normal font has no digit glyphs");
  CTFontGetAdvancesForGlyphs(normal,kCTFontOrientationHorizontal,glyphs,advances,10);double digitWidth=1;
  for(const auto &advance:advances)digitWidth=std::max(digitWidth,std::round(advance.width));
  double normalHeight=std::max(CTFontGetSize(normal)*1.5,CTFontGetAscent(normal)+CTFontGetDescent(normal)+CTFontGetLeading(normal));
  NSArray *items=request[@"items"];require([items isKindOfClass:NSArray.class] && items.count<=10000,"TOO_LARGE","Font measurement cell budget exceeded");
  NSMutableArray *results=[NSMutableArray array];NSUInteger totalCharacters=0,totalRuns=0,totalWidths=0,totalLines=0;
  for(NSDictionary *item in items) {
    require([item isKindOfClass:NSDictionary.class],"INVALID_INPUT","Invalid measurement item");
    NSArray *runs=item[@"runs"],*widths=item[@"widths"];require([runs isKindOfClass:NSArray.class] && runs.count>0 && runs.count<=8192 && [widths isKindOfClass:NSArray.class] && widths.count>0 && widths.count<=16384,"INVALID_INPUT","Invalid measurement runs or widths");
    totalRuns+=runs.count;totalWidths+=widths.count;require(totalRuns<=16384 && totalWidths<=50000,"TOO_LARGE","Font measurement run/width budget exceeded");
    double width=0;for(NSNumber *part in widths){double value=officeMetricNumber(part,0,255);width+=std::floor((256*value+std::floor(128/digitWidth))/256*digitWidth);}
    double indent=officeMetricNumber(item[@"indent"],0,250)*10,rotation=officeMetricNumber(item[@"rotation"],0,180),available=std::max(1.0,width-15-indent);
    bool wrap=[item[@"wrap"] boolValue];
    NSMutableAttributedString *text=[[NSMutableAttributedString alloc] initWithString:@""];
    for(NSDictionary *run in runs){require([run isKindOfClass:NSDictionary.class] && [run[@"text"] isKindOfClass:NSString.class],"INVALID_INPUT","Invalid rich text run");NSString *value=run[@"text"];totalCharacters+=value.length;require(value.length<=32767 && totalCharacters<=1048576,"TOO_LARGE","Font measurement text budget exceeded");CTFontRef face=font(run[@"font"]);[text appendAttributedString:[[NSAttributedString alloc] initWithString:value attributes:@{(__bridge NSString*)kCTFontAttributeName:(__bridge id)face}]];}
    OfficeCF<CTTypesetterRef> typesetter(CTTypesetterCreateWithAttributedString((__bridge CFAttributedStringRef)text));
    double measuredWidth=0,height=0,lastHeight=normalHeight;CFIndex offset=0;
    while(offset<(CFIndex)text.length) {
      require(++totalLines<=100000,"TOO_LARGE","Font measurement line budget exceeded");
      CFIndex length=CTTypesetterSuggestLineBreak(typesetter.value,offset,wrap ? available : 1000000);
      require(length>0,"IO","Text layout made no progress");
      if(!wrap && offset+length<(CFIndex)text.length){unichar last=[text.string characterAtIndex:offset+length-1];require(last=='\n' || last=='\r' || last==0x2028 || last==0x2029,"TOO_LARGE","Unwrapped text exceeds measurement width budget");}
      OfficeCF<CTLineRef> line(CTTypesetterCreateLine(typesetter.value,CFRangeMake(offset,length)));CGFloat ascent=0,descent=0,leading=0;
      double lineWidth=CTLineGetTypographicBounds(line.value,&ascent,&descent,&leading),lineHeight=ascent+descent+std::max((CGFloat)0,leading);
      CGRect bounds=CTLineGetBoundsWithOptions(line.value,kCTLineBoundsUseGlyphPathBounds);lineWidth=std::max(lineWidth,CGRectGetMaxX(bounds))-std::min(0.0,CGRectGetMinX(bounds));
      for(id raw in (__bridge NSArray*)CTLineGetGlyphRuns(line.value)) {
        CTRunRef run=(__bridge CTRunRef)raw;NSDictionary *attrs=(__bridge NSDictionary*)CTRunGetAttributes(run);CTFontRef face=(__bridge CTFontRef)attrs[(__bridge NSString*)kCTFontAttributeName];
        lineHeight=std::max(lineHeight,CTFontGetSize(face)*1.5);OfficeCF<CFStringRef> faceName(CTFontCopyPostScriptName(face));NSString *name=(__bridge NSString*)faceName.value;
        require(![name containsString:@"LastResort"],"UNSUPPORTED","字体缺少内容需要的字符；原尺寸保留");[used addObject:name];require(used.count<=512,"TOO_LARGE","Too many fallback font faces");
      }
      require(std::isfinite(lineWidth) && lineWidth<=1000000 && std::isfinite(lineHeight),"TOO_LARGE","Text measurement exceeds layout budget");
      measuredWidth=std::max(measuredWidth,lineWidth);lastHeight=std::max(1.0,lineHeight);height+=lastHeight;offset+=length;
    }
    if(!text.length || [text.string hasSuffix:@"\n"] || [text.string hasSuffix:@"\r"])height+=lastHeight;
    double angle=(rotation<=90 ? rotation : 90-rotation)*M_PI/180,originalWidth=measuredWidth;
    measuredWidth=std::abs(std::cos(angle))*measuredWidth+std::abs(std::sin(angle))*height;height=std::abs(std::sin(angle))*originalWidth+std::abs(std::cos(angle))*height;
    require(measuredWidth+15+indent<=1000000 && height+5<=1000000,"TOO_LARGE","Text measurement exceeds dimension budget");
    [results addObject:@{@"width":@(std::ceil(measuredWidth+15+indent)),@"height":@(std::ceil(height+5))}];
  }
  return @{@"digitWidth":@(digitWidth),@"lineHeight":@(normalHeight),@"items":results,@"fonts":[used.allObjects sortedArrayUsingSelector:@selector(compare:)]};
}
