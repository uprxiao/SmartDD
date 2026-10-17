import java.io.*;
import java.nio.file.*;
import java.util.*;
import org.apache.poi.xssf.usermodel.*;
import org.apache.poi.xslf.usermodel.*;
import org.apache.poi.ss.usermodel.*;
public class PoiProbe {
 static String q(String s){return "\""+s.replace("\\","\\\\").replace("\"","\\\"").replace("\n","\\n").replace("\r","\\r").replace("\t","\\t")+"\"";}
 static void readXlsx(Path path,String operation,Path target)throws Exception{
  try(XSSFWorkbook w=new XSSFWorkbook(Files.newInputStream(path))){
   if(operation.equals("rename"))w.setSheetName(w.getSheetIndex("Data"),"计划 O'Brien");
   if(operation.equals("delete"))w.removeSheetAt(w.getSheetIndex("Data"));
   FormulaEvaluator e=w.getCreationHelper().createFormulaEvaluator();e.setIgnoreMissingWorkbooks(false);
   List<String>rows=new ArrayList<>();
   for(Sheet s:w)for(Row r:s)for(Cell c:r)if(c.getCellType()==CellType.FORMULA){
    String val;String kind;String err="";
    try{CellValue v=e.evaluate(c);kind=v.getCellType().name();val=switch(v.getCellType()){case ERROR -> FormulaError.forInt(v.getErrorValue()).getString();case NUMERIC -> Double.toString(v.getNumberValue());case STRING -> v.getStringValue();case BOOLEAN -> Boolean.toString(v.getBooleanValue());default -> v.formatAsString();};e.evaluateFormulaCell(c);}
    catch(Exception ex){kind="EXCEPTION";val="";err=ex.toString();}
    rows.add("{\"sheet\":"+q(s.getSheetName())+",\"cell\":"+q(c.getAddress().formatAsString())+",\"formula\":"+q(c.getCellFormula())+",\"type\":"+q(kind)+",\"value\":"+q(val)+",\"exception\":"+q(err)+"}");
   }
   if(target!=null)try(OutputStream out=Files.newOutputStream(target)){w.write(out);}
   System.out.println("{\"engine\":\"Apache POI 5.5.1\",\"operation\":"+q(operation)+",\"cells\":["+String.join(",",rows)+"]}");
  }
 }
 static void readPptx(Path path)throws Exception{
  try(XMLSlideShow p=new XMLSlideShow(Files.newInputStream(path))){
   List<String>tables=new ArrayList<>();List<String>texts=new ArrayList<>();
   for(XSLFSlide s:p.getSlides())for(XSLFShape shape:s.getShapes()){
    if(shape instanceof XSLFTable t)for(XSLFTableRow row:t.getRows())for(XSLFTableCell c:row.getCells())tables.add(q(c.getText()));
    if(shape instanceof XSLFTextShape t)texts.add(q(t.getText()));
   }
   List<String>charts=new ArrayList<>();for(XSLFChart c:p.getCharts()){
    XSSFWorkbook w=c.getWorkbook();charts.add("{\"embeddedB2\":"+w.getSheetAt(0).getRow(1).getCell(1).getNumericCellValue()+",\"chartXml\":"+q(c.getCTChartSpace().xmlText())+"}");
   }
   System.out.println("{\"engine\":\"Apache POI 5.5.1\",\"slides\":"+p.getSlides().size()+",\"masters\":"+p.getSlideMasters().size()+",\"tables\":["+String.join(",",tables)+"],\"texts\":["+String.join(",",texts)+"],\"charts\":["+String.join(",",charts)+"]}");
  }
 }
 public static void main(String[]args)throws Exception{
  if(args[0].equals("pptx"))readPptx(Path.of(args[1]));else readXlsx(Path.of(args[1]),args[0],args.length>2?Path.of(args[2]):null);
 }
}
